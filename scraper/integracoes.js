// Stub de integrações para o produto (raspador de leads).
// No sistema completo isto registra a última execução de cada fonte externa;
// no produto standalone é um no-op — os scrapers chamam anotar() e seguem.
export function anotar() { /* no-op */ }
