# 📚 Dokumentacja Projektu RAZDWA

## 🚀 Start tutaj

Jeśli dopiero zaczynasz z projektem, przeczytaj w tej kolejności:

1. **[README.md](../README.md)** - Przegląd projektu i architektury
2. **[AGENTS.md](../AGENTS.md)** - Zasady rozwoju i standardy kodowania
3. **[SUMMARY.md](../SUMMARY.md)** - Podsumowanie ostatniej refaktoryzacji

## 🎯 Dla deweloperów

### Dodajesz nową kategorię?

→ **[MIGRATION_GUIDE.md](MIGRATION_GUIDE.md)** - Krok po kroku jak dodać nową kategorię

### Chcesz zrozumieć PriceService?

→ **[REFACTORING_PRICE_SERVICE.md](REFACTORING_PRICE_SERVICE.md)** - Pełna dokumentacja techniczna

### Przygotowujesz kopię dla klientki?

→ **[DEPLOY_CLIENT.md](DEPLOY_CLIENT.md)** - Jak zbudować i spakować gotową kopię aplikacji

## 📁 Struktura dokumentacji

```
docs/
├── index.md                          # ← Ten plik (nawigacja)
├── REFACTORING_PRICE_SERVICE.md      # Dokumentacja techniczna refaktoryzacji
└── MIGRATION_GUIDE.md                # Przewodnik dla deweloperów
```

## 🔧 Narzędzia

### Weryfikacja refaktoryzacji

```bash
node tests/verify-refactoring.js
```

Sprawdza czy wszystkie moduły używają priceService poprawnie.

### Testy funkcjonalne

```bash
# Wymaga: npm install
npm test
```

### Kompilacja TypeScript

```bash
# Wymaga: npm install
npx tsc
```

## 📖 Dokumenty według tematu

### Architektura

- [README.md](../README.md) - Wielowarstwowa architektura projektu
- [REFACTORING_PRICE_SERVICE.md](REFACTORING_PRICE_SERVICE.md) - Warstwa serwisowa

### Rozwój

- [AGENTS.md](../AGENTS.md) - Zasady i standardy
- [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) - Jak dodać nową kategorię

### Historia zmian

- [SUMMARY.md](../SUMMARY.md) - Podsumowanie refaktoryzacji PriceService

## 🎓 Kluczowe koncepty

### PriceService

Centralna warstwa dostępu do danych cenowych. Zapewnia:

- Single source of truth
- Cache dla wydajności
- Łatwe testowanie
- Separation of concerns

**Przykład:**

```typescript
import { priceService } from "../services/priceService";

const prices = priceService.loadSync("banner");
```

### Moduły kalkulacyjne

Logika wyliczania cen dla każdej kategorii produktów.

**Lokalizacja:** `/src/categories/`

**Wzorzec:**

```typescript
export function calculateCategory(options) {
  const data = priceService.loadSync("category-name");
  // logika kalkulacji
  return result;
}
```

### Dane cenowe

Znormalizowane struktury JSON z cenami i progami.

**Lokalizacja:** `/data/normalized/`

**Format:**

```json
{
  "id": "category",
  "title": "Nazwa kategorii",
  "unit": "szt",
  "tiers": [{ "min": 1, "max": 10, "price": 5.0 }],
  "modifiers": [{ "id": "express", "type": "percent", "value": 0.2 }]
}
```

## ❓ FAQ

### Gdzie dodać nową kategorię?

Zobacz [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) sekcja "Kroki migracji".

### Jak zmodyfikować cenę?

```typescript
priceService.setPriceByPath("category.tiers.0.price", 60.0);
```

### Jak testować moduł?

Zobacz testy w `/tests/priceService.test.ts`.

### Czy mogę importować JSON bezpośrednio?

❌ NIE - zawsze używaj `priceService.loadSync()`.

## 🔗 Linki zewnętrzne

- **TypeScript:** https://www.typescriptlang.org/
- **Vitest:** https://vitest.dev/
- **esbuild:** https://esbuild.github.io/

## 📞 Kontakt

Pytania? Problemy? Sprawdź:

1. FAQ w tym dokumencie
2. [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md)
3. Issues w repozytorium

---

**Ostatnia aktualizacja:** 2026-02-25  
**Wersja dokumentacji:** 1.0  
**Status projektu:** ✅ Produkcyjny
