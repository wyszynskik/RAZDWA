export interface CustomerFormData {
  name: string;
  email: string;
  phone: string;
  nip?: string;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalizePhoneDigits(phone: string): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length > 9 && digits.startsWith("48")) {
    return digits.slice(2);
  }
  return digits;
}

export function isValidPhone(phone: string): boolean {
  return normalizePhoneDigits(phone).length === 9;
}

export function validateCustomerForm(data: CustomerFormData): string | null {
  if (!data.name.trim()) return "Podaj imię i nazwisko klienta.";
  if (data.name.trim().length < 2) return "Imię i nazwisko musi mieć min. 2 znaki.";
  if (!data.email.trim()) return "Podaj adres e-mail klienta.";
  if (!isValidEmail(data.email.trim())) return "Nieprawidłowy format e-mail.";
  if (!data.phone.trim()) return "Podaj numer telefonu klienta.";
  if (!isValidPhone(data.phone))
    return "Numer telefonu musi mieć 9 cyfr (krajowy, opcjonalnie z prefiksem +48).";
  if (data.nip) {
    const nipDigits = data.nip.replace(/\D/g, "");
    if (nipDigits.length !== 10) return "NIP musi zawierać 10 cyfr";
  }
  return null;
}
