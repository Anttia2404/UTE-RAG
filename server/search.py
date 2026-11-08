import json
import os
import subprocess
from pathlib import Path

from dotenv import load_dotenv
from elasticsearch import Elasticsearch, helpers


ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env.local", override=False)
INDEX_NAME = os.getenv("ELASTICSEARCH_INDEX", "tuition-knowledge")
ES_URL = os.getenv("ELASTICSEARCH_URL", "http://127.0.0.1:9200")
_client = None
_static_indexed = False


def client():
    global _client
    if _client is None:
        _client = Elasticsearch(ES_URL, request_timeout=2, max_retries=0)
    return _client


def is_available():
    try:
        return bool(client().ping())
    except Exception:
        return False


def _mapping():
    return {
        "mappings": {
            "properties": {
                "sourceId": {"type": "keyword"},
                "documentId": {"type": "keyword"},
                "announcementId": {"type": "keyword"},
                "sourceTitle": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
                "sourceHref": {"type": "keyword", "index": False},
                "section": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
                "text": {"type": "text", "analyzer": "standard"},
                "cohort": {"type": "keyword"},
                "major": {"type": "keyword"},
                "semester": {"type": "keyword"},
                "academicYear": {"type": "keyword"},
                "feeType": {"type": "keyword"},
            }
        }
    }


def ensure_index():
    global _static_indexed
    es = client()
    if not es.ping():
        return False
    if not es.indices.exists(index=INDEX_NAME):
        es.indices.create(index=INDEX_NAME, **_mapping())
    if not _static_indexed:
        index_file = ROOT / "public" / "kb" / "chunks.json"
        if index_file.exists():
            data = json.loads(index_file.read_text(encoding="utf-8"))
            def actions():
                for chunk in data.get("chunks", []):
                    yield {
                        "_index": INDEX_NAME,
                        "_id": f"static:{chunk['id']}",
                        "_source": {
                            "sourceId": chunk["sourceId"],
                            "sourceTitle": chunk["sourceTitle"],
                            "sourceHref": chunk["sourceHref"],
                            "section": chunk["section"],
                            "text": chunk["text"],
                        },
                    }
            helpers.bulk(es, actions(), raise_on_error=True)
        _static_indexed = True
    return True


def index_knowledge_nodes(document, nodes, announcement=None):
    if not is_available():
        return False
    es = client()
    if not es.indices.exists(index=INDEX_NAME):
        es.indices.create(index=INDEX_NAME, **_mapping())
    announcement_id = announcement.id if announcement else None
    actions = (
        {
            "_index": INDEX_NAME,
            "_id": f"upload:{node.id}",
            "_source": {
                "sourceId": document.id,
                "documentId": document.id,
                "announcementId": announcement_id,
                "sourceTitle": announcement.title if announcement else document.original_name,
                "sourceHref": f"/api/documents/{document.id}/file",
                "section": node.section,
                "text": node.content,
                "cohort": announcement.cohort if announcement else None,
                "major": announcement.major if announcement else None,
                "semester": announcement.semester if announcement else None,
                "academicYear": announcement.academic_year if announcement else None,
                "feeType": announcement.fee_type if announcement else None,
            },
        }
        for node in nodes
    )
    helpers.bulk(es, actions, raise_on_error=True)
    return True


def search_chunks(query, filters=None, source_ids=None, limit=5):
    if not is_available():
        return None
    filters = filters or {}
    must = [{"multi_match": {"query": query, "fields": ["sourceTitle^3", "section^2", "text"], "type": "best_fields", "operator": "or"}}]
    filter_terms = []
    for field, value in {
        "cohort": filters.get("cohort"),
        "major": filters.get("major"),
        "semester": filters.get("semester"),
        "academicYear": filters.get("academicYear"),
        "feeType": filters.get("feeType"),
    }.items():
        if value:
            filter_terms.append({"term": {field: value}})
    if source_ids:
        filter_terms.append({"terms": {"sourceId": source_ids}})
    result = client().search(
        index=INDEX_NAME,
        size=max(1, min(limit, 20)),
        query={"bool": {"must": must, "filter": filter_terms}},
    )
    return [hit["_source"] | {"score": hit.get("_score", 0)} for hit in result["hits"]["hits"]]


def fallback_static_chunks(query, source_ids=None):
    script = ROOT / "scripts" / "retrieve-kb.mjs"
    payload = json.dumps({"query": query, "sourceIds": source_ids or []}, ensure_ascii=False)
    result = subprocess.run(
        ["node", str(script)], input=payload, capture_output=True, text=True,
        encoding="utf-8", cwd=ROOT, timeout=120, check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("Không truy hồi được tài liệu. Hãy bật Elasticsearch hoặc kiểm tra knowledge base.")
    return json.loads(result.stdout)


def search_for_chat(query, filters=None, source_ids=None, limit=5):
    chunks = search_chunks(query, filters=filters, source_ids=source_ids, limit=limit)
    if chunks is not None:
        return chunks
    return fallback_static_chunks(query, source_ids=source_ids)


def search_for_student(query, filters=None, limit=20):
    return search_chunks(query, filters=filters, limit=limit) if is_available() else None
