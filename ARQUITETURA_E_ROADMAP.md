# Arquitetura e Roadmap (v2) — Stack única em Next.js + TypeScript

> Substitui a arquitetura anterior (Next.js + FastAPI separados). Decisão: um
> único aplicativo Next.js, evitando manter dois serviços/deploys.

## O que já está pronto nesta etapa

**App Router (Next.js 16, Turbopack) já implementado e validado com `next build` + `next start` reais:**

| Caminho | O que é |
|---|---|
| `src/app/layout.tsx` | Root layout (Tailwind v4 via `globals.css`) |
| `src/app/page.tsx` | Página inicial (placeholder do Dashboard) |
| `src/app/api/health/route.ts` | Route Handler de exemplo simples |
| `src/app/api/martingale-calculations/route.ts` | Route Handler **real**, valida com Zod e chama `calculateMode1`/`calculateMode2` do `core` diretamente — testado via HTTP, reproduzindo os mesmos valores do enunciado (Martingale 1 = R$7,06, Martingale 2 = R$15,37) |
| `src/app/api/candles/import/route.ts` | Importação de CSV (FormData) → `candles` |
| `src/app/api/candles/import-yahoo/route.ts` | Importação **direto do Yahoo Finance** (dados reais de mercado, sem CSV) → `candles` |
| `src/app/api/analyses/route.ts` + `[id]/route.ts` | Criação/execução/consulta de análises |
| `src/app/api/pattern-results/route.ts` | Lista filtrada e paginada de padrões |
| `src/app/api/backtests/route.ts` | Criação/listagem de backtests (execução na Fase 3) |

`src/lib/core/` — motor de domínio, portado de Python para TypeScript preservando
exatamente as mesmas regras e casos de teste:

| Arquivo | Responsabilidade | Biblioteca-chave |
|---|---|---|
| `candle-classifier.ts` | Classificação CALL/PUT/DOJI, tolerância configurável | `decimal.js` (evita erro de float) |
| `pattern-analyzer.ts` | Agrupamento por horário respeitando timezone, percentuais, continuidade, status, ranking | `luxon` (timezone/DST, equivalente ao `zoneinfo` do Python) |
| `martingale-calculator.ts` | Modo 1 (entrada informada) e Modo 2 (busca binária), recuperação de perdas, arredondamento validado | `decimal.js` |
| `data-provider.ts` | Interface `CandleDataProvider` + `CSVCandleProvider`, normalização de símbolo, detecção de gaps/duplicados | — |

`src/lib/analysis/` — camada de orquestração acima do `core`, sem dependência de HTTP:

| Arquivo | Responsabilidade |
|---|---|
| `run-analysis.ts` | **Puro**: recebe `Candle[]` + configuração e devolve um `PatternResult` por par/horário. Descobre os horários a partir dos candles existentes (não inventa slots), aplica janela de horários (inclusive atravessando a meia-noite), dias da semana e o filtro de percentual mínimo |
| `analysis-service.ts` | Carrega candles pelo `DbCandleProvider`, chama `runAnalysis`, grava os `pattern_results` e mantém `analyses.status`/`progressPct` — é exatamente a função que a fila da Fase 4 vai chamar |

`src/lib/db/` — acesso a dados reaproveitável pelas rotas:
`candle-provider.ts` (`DbCandleProvider`, implementa a mesma interface `CandleDataProvider` do CSV),
`currency-pairs.ts` (resolução idempotente de símbolo → `currency_pair_id`) e
`persist-candles.ts` (grava candles de **qualquer** provider em lotes com dedup, bookkeeping de `import_jobs` — compartilhado pela importação CSV e pela do Yahoo Finance).

`src/lib/external/yahoo-finance.ts` — `YahooFinanceCandleProvider`, mesma interface `CandleDataProvider`,
busca candles reais no endpoint não-oficial do Yahoo Finance (`query1.finance.yahoo.com/v8/finance/chart`).
**Sem autenticação, sem SLA, sem documentação oficial** — validado empiricamente (não por documentação)
contra o endpoint real. Limitação importante: candles intraday só existem numa janela móvel a partir de
"agora" (1m → 8 dias; 5m/15m/30m/90m → 60 dias; 60m/1h → ~730 dias; 1d+ → sem limite conhecido) — não é
paginação, o histórico mais antigo simplesmente não existe na fonte. `resolveImportWindow` ajusta a janela
pedida para o que está disponível e a rota **avisa explicitamente** (`windows[].truncated` + `warning`)
em vez de cortar silenciosamente.

`src/lib/api/` — `http.ts` (formato único de erro, serialização de `Decimal` como string, validadores Zod compartilhados) e
`current-user.ts` (**placeholder** de autenticação, ver aviso abaixo).

Testes (Vitest): **55 passando** — 35 do motor de domínio, 10 de `run-analysis`
(exemplo do enunciado incluso: 30 dias, 24 PUT, 6 CALL, 80%; timezone; janela de
horários; dias da semana; ordenação e filtro) e 10 de `yahoo-finance` (parsing,
truncamento de janela, tratamento de erro — com fetch mockado, sem depender de rede).

`src/db/schema.ts`: schema **Drizzle ORM** com as 14 entidades do domínio (User, DataProvider, CurrencyPair, Candle, Analysis, AnalysisConfiguration, PatternResult, Backtest, BacktestOperation, BankrollConfiguration, MartingaleCalculation, MartingaleLevel, ImportJob, AuditLog), índices em par+timeframe+horário (a consulta mais frequente do sistema) e foreign keys corretas. Migration inicial já gerada e validada em `src/db/migrations/0000_bumpy_power_pack.sql`.

`src/db/client.ts`: cliente configurado para **Neon** (driver serverless HTTP, `drizzle-orm/neon-http`), lendo `DATABASE_URL` do ambiente.

## Como rodar localmente

```bash
npm install
cp .env.example .env.local   # editar com sua connection string do Neon
npm run test                 # 45 testes (motor de domínio + orquestração)
npm run typecheck
npm run dev                  # http://localhost:3000
```

Para conferir o build de produção (o mesmo que rodaria em deploy):

```bash
npm run build
npm run start
```

## Como conectar ao Neon

1. Criar um projeto em https://console.neon.tech
2. Copiar a connection string para `.env.local` (baseado em `.env.example`)
3. Rodar as migrations:
   ```bash
   npm run db:generate   # já executado uma vez, gera SQL a partir do schema
   npm run db:migrate    # aplica no banco do Neon
   ```

## API (Fase 2)

| Método e rota | O que faz |
|---|---|
| `POST /api/candles/import` | CSV via `multipart/form-data` (`file`, opcionalmente `dataProviderId` e `source`). Usa `CSVCandleProvider`, resolve/cria os `currency_pairs`, insere em lotes de 500 com `ON CONFLICT DO NOTHING` e registra tudo em `import_jobs`. Responde com totais de linhas importadas/duplicadas |
| `GET /api/candles/import?jobId=` | Status de uma importação (ou lista todas) |
| `POST /api/candles/import-yahoo` | Importa candles **reais** do Yahoo Finance por símbolo (`"EUR/USD"`) + timeframe + período opcional. Sem CSV. Avisa explicitamente (`windows[].truncated`, `warning`) quando o período pedido excede o histórico intraday disponível na fonte |
| `POST /api/analyses` | Cria `Analysis` + `AnalysisConfiguration`, valida timezone e pares, e executa a análise. `?process=false` cria sem executar. `topN` (default 10) mantém só os N horários com maior `repetitionPct` — é o "ranking de até 10 horários acima de X%" |
| `GET /api/analyses` | Lista as análises do usuário |
| `GET /api/analyses/:id` | Detalhe + configuração + `status`/`progressPct` (polling) |
| `DELETE /api/analyses/:id` | Remove a análise (cascade nos resultados) |
| `GET /api/pattern-results` | Lista paginada com filtros `analysisId`, `currencyPairId`, `timeframe`, `timeOfDay`, `status`, `direction`, `minPct`, `onlyActive`, ordenação `sortBy`/`order` e `limit`/`offset` |
| `POST /api/backtests` | Valida e persiste todos os parâmetros da simulação; responde **202** com `status: "pending"` (execução = Fase 3) |
| `GET /api/backtests` | Lista os backtests do usuário |
| `POST /api/martingale-calculations` | Calculadora de entradas (sem banco) |

Convenções da API:
- Valores monetários e percentuais trafegam como **string**, nunca como number — a
  mesma garantia de precisão do `decimal.js` e do `numeric` do Postgres, ponta a ponta.
- Erros sempre no formato `{ "error": "...", "details"?: ... }`, com 400 (validação),
  401 (não autenticado), 404, 413, 422 (regra de negócio) ou 500.
- Toda leitura é restrita ao usuário autenticado via `INNER JOIN` — não é possível
  ler resultados de outro usuário nem informando o id dele.

### ⚠️ Autenticação ainda não implementada

`src/lib/api/current-user.ts` é um **placeholder**: resolve o usuário pelo cabeçalho
`x-user-id` ou pela variável `DEV_USER_ID`, e **falha com 501 quando
`NODE_ENV=production`**. Isso é proposital — um header controlado pelo cliente
permitiria personificar qualquer usuário, então é melhor que a rota se recuse a
funcionar em produção do que parecer segura sem ser. Ao implementar a autenticação
real (JWT ou `next-auth`), basta trocar o corpo de `requireUserId`: nenhuma rota
precisa mudar.

## Roadmap das próximas fases

### Fase 2 — Route Handlers (API do Next) — CONCLUÍDA (exceto autenticação)
Todas as rotas acima estão implementadas. Pendências conhecidas:
- **Autenticação** (JWT ou `next-auth`) — ver aviso acima.
- **Execução dentro do request**: `POST /api/analyses` processa a análise no próprio
  request. Para períodos longos isso pode estourar o tempo máximo do provedor de
  deploy; `analyses.status`/`progressPct` e `?process=false` já existem para a
  migração à fila da Fase 4.
- **Testes de rota** (com banco) ainda não escritos — ver Fase 7. Hoje a cobertura
  automatizada é do motor puro (`core` + `analysis`); as rotas foram exercitadas
  manualmente via HTTP.

### Fase 2.5 — shadcn/ui
`npx shadcn@latest init` (Tailwind v4 já configurado, compatível). Necessário para os componentes de formulário/tabela das 16 telas.

### Fase 3 — Motor de Backtest cronológico
Construído sobre `pattern-analyzer.ts`, mas recalculando a predominância
**apenas com os dias anteriores** a cada operação simulada (rolling window),
para não usar dados futuros. Aplica `martingale-calculator.ts` operação a
operação e agrega métricas (drawdown, sequências, resultado por moeda/timeframe/
horário/dia da semana/mês).

### Fase 4 — Processamento assíncrono
Sem Celery/Redis nesta stack: usar **Vercel Queues / Inngest / Trigger.dev**
(ou, se preferir algo mais simples de operar, um cron job + tabela de jobs
como já modelada em `import_jobs`/`analyses.status`/`backtests.status`) para
importações e backtests longos, com progresso consultável pelo frontend via
polling (`TanStack Query` com `refetchInterval`).

### Fase 5 — Frontend (as 16 telas)
Next.js App Router + Tailwind + shadcn/ui + TanStack Query + React Hook Form +
Zod + Recharts, consumindo as rotas da Fase 2. Os schemas Zod dos formulários
podem importar os mesmos tipos de `src/lib/core`, garantindo que a validação
do formulário e a regra de negócio nunca divirjam.

### Fase 6 — Deploy
Um único deploy (Vercel, por exemplo) para o Next.js inteiro; o banco fica no
Neon (serverless, sem servidor pra gerenciar). Sem Docker Compose necessário
para produção — útil manter um `docker-compose.yml` simples só para rodar
Postgres localmente em desenvolvimento, se não quiser depender do Neon
também em dev.

### Fase 7 — Segurança, testes de integração, auditoria
Rate limiting nas rotas, testes de rota com Vitest + `next-test-api-route-handler`
(ou similar), e gravação em `audit_logs` nas ações sensíveis.

## Por que a migração para TS não perdeu nada

Os 35 testes em Vitest cobrem exatamente os mesmos cenários que os 29 testes
em Python cobriam (incluindo os 6 testes extras de `data-provider`, que
antes não tinham arquivo de teste próprio). O exemplo numérico do enunciado
(payout 85%, entrada R$5, lucro mínimo R$1 → Martingale 1 = R$7,06, Martingale
2 = R$15,37) está verificado byte a byte nos dois idiomas, e também via
requisição HTTP real à rota `/api/martingale-calculations`.

## O que está verificado e o que não está

Verificado contra um Neon real (não só compilação):
- `npm run db:migrate` aplicado com sucesso (14 tabelas).
- Fluxo ponta a ponta via HTTP: importar CSV sintético (30 dias, 6 CALL/24 PUT) →
  criar análise → resultado bateu exatamente com o exemplo do enunciado
  (`repetitionPct: "80.00"`, `status: "forte_e_ativo"`) → criar backtest (202 pending).
- Reimportar o mesmo CSV → `importedRows: 0`, dedup via índice único funcionando.
- Isolamento por usuário: um segundo usuário não vê as análises do primeiro
  (lista vazia e 404 ao tentar acessar por id).
- **Importação real do Yahoo Finance**: EUR/USD + GBP/USD, 5m, últimos 3 dias →
  1100 candles reais importados; rodar a análise sobre eles funcionou (579 candles
  carregados, 288 padrões de horário encontrados — números diferentes do CSV
  sintético porque dados reais têm candles em vários minutos do dia, não só um
  horário fixo). Truncamento de janela testado (1m pedindo 30 dias → ajustado para
  8 dias, com aviso explícito na resposta). Erro de símbolo inexistente → 502 com
  mensagem clara.
- **Ranking com `topN`**: EUR/GBP real (30 dias, M5, janela 06:00-12:00, `minRepetitionPct: 70`,
  `topN: 10`) → dos horários no intervalo, só 5 passaram do limite de 70%
  (07:20 PUT 72,73%, 09:20 PUT 72,73%, 10:00 CALL 71,43%, 10:25 CALL 71,43%,
  10:35 PUT 70,00%) — exatamente o caso de uso de "ranking de até N horários
  acima de X%" descrito pelo usuário. Confirmado que análises criadas antes
  dessa coluna existir (`top_n`) migraram com o default (10) sem quebrar.
- `npm run test` → 57 testes. `npm run typecheck` → sem erros. `npm run build` →
  limpo, 10 rotas.

**Segurança**: o projeto não tinha `.gitignore` até esta sessão — o `.env` com a
connection string real do Neon estava exposto para `git add` (nunca houve commit,
então nada vazou). Criado antes de qualquer outra alteração.

**Ainda não verificado**: motor de backtest (não existe ainda, é a Fase 3);
autenticação real; comportamento do Yahoo Finance em produção sob uso sustentado
(é endpoint não-oficial — risco de bloqueio/rate limit não testado).

## Próximos passos sugeridos

1. Autenticação real, substituindo o placeholder de `current-user.ts`.
2. Fase 3 — motor de backtest cronológico (agora com uma fonte de dados real
   disponível via Yahoo Finance para testar contra mercado de verdade).
3. Fase 2.5 (shadcn/ui) para começar o frontend.
