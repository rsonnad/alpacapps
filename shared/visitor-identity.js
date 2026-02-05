// Visitor Identity - persists name/email/phone in localStorage
// Used to auto-fill followup forms across the site

const STORAGE_KEY = 'alpaca_visitor';

export function saveVisitor({ name, email, phone }) {
  const data = getVisitor();
  if (name) data.name = name;
  if (email) data.email = email;
  if (phone) data.phone = phone;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function getVisitor() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}
