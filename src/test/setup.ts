// The /vitest subpath augments Vitest's Assertion interface; the bare import
// augments Jest's expect, which leaves toBeInTheDocument() a type error here
// even though it works at runtime.
import '@testing-library/jest-dom/vitest';
