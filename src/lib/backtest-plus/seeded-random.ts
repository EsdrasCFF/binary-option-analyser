/**
 * Gerador pseudoaleatório DETERMINÍSTICO (mulberry32) — usado pelos modelos
 * RANDOM e WEIGHTED_SCORE do Backtest Plus.
 *
 * NUNCA usar Math.random() direto na seleção: o mesmo `randomSeed` precisa
 * produzir exatamente a mesma sequência de números sempre que o backtest for
 * reprocessado/reaberto (seção 8/49 do briefing — "fechar e abrir o backtest
 * novamente sem que nada mude"). A geração do PRÓPRIO seed (uma vez só, na
 * criação) pode usar entropia real — só a SELEÇÃO em si precisa ser
 * reproduzível — ver `generateRandomSeed` no service, não aqui.
 *
 * Implementação pública padrão (mulberry32), pequena, sem dependência
 * externa. Não é criptograficamente segura — não precisa ser, é só
 * reprodutibilidade determinística.
 */
export type SeededRandom = () => number; // retorna um número em [0, 1)

export function createSeededRandom(seed: number): SeededRandom {
  // >>> 0 força um uint32 — mesmo comportamento pra qualquer inteiro de entrada.
  let state = seed >>> 0;
  return function mulberry32(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inteiro aleatório em [0, maxExclusive) usando o gerador seeded — usado pra sortear índices sem viés perceptível para os tamanhos pequenos deste domínio (pool de até 10). */
export function randomInt(rng: SeededRandom, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}
