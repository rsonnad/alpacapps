// Booking request form: builds a message and opens WhatsApp or email (static site, no backend).
(function () {
  const WHATSAPP = '66968862601';
  const EMAIL = 'mistiqzen@alpacaplayhouse.com';
  const th = document.documentElement.lang === 'th';

  const t = th ? {
    subject: 'คำขอจอง Mistiq Massage',
    intro: 'สวัสดีค่ะ ขอจอง Mistiq Massage',
    type: 'รูปแบบ', name: 'ชื่อ', phone: 'โทร/WhatsApp', email: 'อีเมล', date: 'วันที่', time: 'เวลา',
    experience: 'ประสบการณ์', notes: 'หมายเหตุ', social: 'โซเชียลมีเดีย',
    partner: 'ยินดีให้ฟีดแบ็กละเอียด อัดวิดีโอรีวิว และช่วยประชาสัมพันธ์',
    needContact: 'กรุณากรอกเบอร์โทร/WhatsApp หรืออีเมล',
    needPartner: 'สำหรับเซสชันฟรี กรุณายืนยันการให้ฟีดแบ็กและอัดวิดีโอรีวิว',
    locale: 'th-TH',
  } : {
    subject: 'Mistiq Massage Booking Request',
    intro: 'Hello Ivy, I would like to book a Mistiq Massage session.',
    type: 'Session', name: 'Name', phone: 'Phone/WhatsApp', email: 'Email', date: 'Date', time: 'Time',
    experience: 'Experience', notes: 'Notes', social: 'Social media',
    partner: 'I agree to give detailed feedback, record a video testimonial and help with marketing.',
    needContact: 'Please enter a WhatsApp/phone number or an email address.',
    needPartner: 'For a free session, please confirm detailed feedback and a video testimonial.',
    locale: 'en-US',
  };

  const $ = id => document.getElementById(id);
  const form = $('booking-form');
  const typeSel = $('book-type');
  const partnerFields = $('partner-fields');

  const params = new URLSearchParams(location.search);
  if (params.get('type') === 'partner') typeSel.value = 'partner';
  const syncPartner = () => partnerFields.classList.toggle('zen-partner-fields--open', typeSel.value === 'partner');
  typeSel.addEventListener('change', syncPartner);
  syncPartner();

  $('book-date').setAttribute('min', new Date().toISOString().split('T')[0]);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const via = (e.submitter && e.submitter.value) || 'whatsapp';
    const partner = typeSel.value === 'partner';
    const phone = $('book-phone').value.trim();
    const email = $('book-email').value.trim();

    if (!phone && !email) { alert(t.needContact); return; }
    if (partner && !($('partner-feedback').checked && $('partner-video').checked)) { alert(t.needPartner); return; }

    const date = $('book-date').value;
    const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString(t.locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const timeLabel = $('book-time').selectedOptions[0].textContent;
    const notes = $('book-notes').value.trim();
    const social = $('book-social').value.trim();

    const body = [
      t.intro,
      ' ',
      `${t.type}: ${typeSel.selectedOptions[0].textContent}`,
      `${t.name}: ${$('book-name').value.trim()}`,
      phone ? `${t.phone}: ${phone}` : '',
      email ? `${t.email}: ${email}` : '',
      `${t.date}: ${dateLabel}`,
      `${t.time}: ${timeLabel}`,
      `${t.experience}: ${$('book-experience').selectedOptions[0].textContent}`,
      notes ? `${t.notes}: ${notes}` : '',
      partner ? `✓ ${t.partner}` : '',
      partner && social ? `${t.social}: ${social}` : '',
    ].filter(Boolean).join('\n').replace(/\n \n/, '\n\n');

    const url = via === 'email'
      ? `mailto:${EMAIL}?subject=${encodeURIComponent(t.subject + ' — ' + dateLabel)}&body=${encodeURIComponent(body + '\n\nalpacaplayhouse.com/mistiqzen/book/')}`
      : `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(body)}`;
    if (via === 'email') location.href = url;
    else window.open(url, '_blank');

    form.style.display = 'none';
    $('booking-confirm').style.display = 'block';
  });
})();
