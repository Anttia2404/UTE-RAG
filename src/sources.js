export const sources = {
  '2807': {
    id: '2807',
    title: 'Quy định thu học phí năm học 2026–2027',
    label: 'QĐ 2807/QĐ-ĐHCNKT · Mục III.2 · Thời gian thu',
    href: '/sources/2807-QD-DHCNKT_Quy-dinh-thu-hoc-phi-2026-2027.md',
  },
  '47': {
    id: '47',
    title: 'Hoàn thành nghĩa vụ học phí sau đại học',
    label: 'TB 47/TB-KHTC',
    href: '/sources/47-TB-KHTC_Hoan-thanh-nghia-vu-hoc-phi-sau-dai-hoc.md',
  },
  '49': {
    id: '49',
    title: 'Học phí học kỳ I năm học 2026–2027',
    label: 'TB 49/TB-KHTC',
    href: '/sources/49-TB-KHTC_Hoan-thanh-nghia-vu-hoc-phi-HK1-2026-2027.md',
  },
  '51': {
    id: '51',
    title: 'Thực hiện chính sách học phí',
    label: 'TB 51/TB-KHTC',
    href: '/sources/51-TB-KHTC_Thuc-hien-Quy-dinh-chinh-sach-hoc-phi.md',
  },
};

export const starterQuestions = [
  'Học kỳ I năm học 2026–2027 thu học phí khi nào?',
  'Sinh viên có thể xin gia hạn học phí không?',
  'Thủ tục miễn, giảm học phí là gì?',
];

export const sampleConversation = [
  {
    role: 'user',
    content: 'Học kỳ I năm học 2026–2027 đóng học phí đến ngày nào?',
  },
  {
    role: 'assistant',
    content:
      'Học kỳ I năm học 2026–2027, học phí học kỳ và các học phần đăng ký đầu kỳ được thu từ **24/08 đến 25/09/2026**.\n\nHọc phần đăng ký bổ sung: thu từ **02/11 đến 27/11/2026**.',
    citations: [{ sourceId: '2807' }],
    suggestions: ['Học phần đăng ký bổ sung thu khi nào?', 'Trường hợp nào được xin gia hạn?'],
  },
];
