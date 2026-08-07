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
`current-user.ts` (resolve o usuário via Auth.js, ver seção de autenticação abaixo).

`src/lib/backtest/` — motor de backtest cronológico, ver seção própria abaixo.

Testes (Vitest): **70 passando** — 36 do motor de domínio (incluindo `topN` em
`rankPatterns`), 11 de `run-analysis` (exemplo do enunciado incluso: 30 dias, 24
PUT, 6 CALL, 80%; timezone; janela de horários; dias da semana; ordenação, filtro
e `topN`), 10 de `yahoo-finance` (parsing, truncamento de janela, tratamento de
erro — com fetch mockado, sem depender de rede) e 13 de `run-backtest`
(cascata entre horários da escada, não pela força do ranking, esgotamento,
as 3 políticas de DOJI, `contrarian`, não-olhar-o-futuro, agregação por grupo
— ver seção própria da Fase 3 para o desenho atual do motor).

`src/db/schema.ts`: schema **Drizzle ORM** com as 14 entidades do domínio (User, DataProvider, CurrencyPair, Candle, Analysis, AnalysisConfiguration, PatternResult, Backtest, BacktestOperation, BankrollConfiguration, MartingaleCalculation, MartingaleLevel, ImportJob, AuditLog), índices em par+timeframe+horário (a consulta mais frequente do sistema) e foreign keys corretas. Migration inicial já gerada e validada em `src/db/migrations/0000_bumpy_power_pack.sql`.

`src/db/client.ts`: cliente configurado para **Neon** (driver serverless HTTP, `drizzle-orm/neon-http`), lendo `DATABASE_URL` do ambiente.

## Como rodar localmente

```bash
npm install
cp .env.example .env.local   # editar com sua connection string do Neon
npm run test                 # 70 testes (motor de domínio + orquestração + backtest)
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
| `POST /api/backtests` | Cria e **executa** a simulação cronológica (`src/lib/backtest`). `?process=false` cria sem executar |
| `GET /api/backtests` | Lista os backtests do usuário |
| `GET /api/backtests/:id` | Detalhe + `status`/`progressPct` + `summary` agregado (polling) |
| `GET /api/backtests/:id/operations` | Lista paginada das operações simuladas, filtra por par/horário/resultado |
| `POST /api/martingale-calculations` | Calculadora de entradas (sem banco) |

Convenções da API:
- Valores monetários e percentuais trafegam como **string**, nunca como number — a
  mesma garantia de precisão do `decimal.js` e do `numeric` do Postgres, ponta a ponta.
- Erros sempre no formato `{ "error": "...", "details"?: ... }`, com 400 (validação),
  401 (não autenticado), 404, 413, 422 (regra de negócio) ou 500.
- Toda leitura é restrita ao usuário autenticado via `INNER JOIN` — não é possível
  ler resultados de outro usuário nem informando o id dele.

### ✅ Autenticação — Auth.js v5 (Google)

Implementada com **Auth.js v5** (`next-auth@beta`, `5.0.0-beta.32` — ainda não é
1.0 estável, mas é o caminho padrão para App Router e amplamente usado nessa fase
beta) com **Google como único provider** por enquanto (plano: ampliar depois).

| Peça | O que faz |
|---|---|
| `src/auth.ts` | Config central: provider Google, sessão em **JWT** (sem tabelas `accounts`/`sessions` do adapter oficial) |
| `src/app/api/auth/[...nextauth]/route.ts` | Expõe os endpoints padrão do Auth.js (`/api/auth/signin`, `/callback/google`, `/session` etc.) |
| `src/lib/api/current-user.ts` | Não é mais placeholder: `requireUserId()` chama `auth()` e lança 401 sem sessão |
| `src/app/page.tsx` | Botão "Entrar com Google" / "Sair" via Server Actions (`signIn`/`signOut`) |

Como o `sub` do Google não é o `id` usado nas foreign keys do sistema, o callback
`jwt` em `src/auth.ts` resolve (ou cria, no primeiro login) a linha correspondente
em `users` **por e-mail** e grava esse UUID interno no token — é ele que vira
`session.user.id` e o que `requireUserId()` devolve. `users.password_hash` virou
nullable (migration `0002`), já que usuários via Google não têm senha própria.

**Variáveis de ambiente** (`.env.example`): `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
(OAuth Client do Google Cloud Console) e `AUTH_SECRET` (assinatura/criptografia da
sessão). Redirect URI a registrar no Google Cloud: `http://localhost:3000/api/auth/callback/google`
em dev (trocar o domínio em produção).

**Verificado**: `/api/auth/providers` expõe o Google corretamente; rota protegida
sem sessão → 401; simulei uma sessão válida assinando um cookie com o mesmo
`AUTH_SECRET` (via a própria função `encode` do Auth.js) para testar o caminho real
de verificação ponta a ponta sem precisar clicar na tela de consentimento do
Google — `/api/auth/session` devolveu o usuário mapeado corretamente e a rota
protegida autorizou (200); cookie adulterado → sessão nula → 401. **Não
verificado**: o clique real "Entrar com Google" (consentimento do Google só pode
ser feito por um humano) e a criação de usuário novo pelo fluxo OAuth real (o
upsert por e-mail no callback `jwt` só roda com `account` presente, o que só
acontece num login real) — vale você testar uma vez no navegador para fechar essa
ponta.

## Roadmap das próximas fases

### Fase 2 — Route Handlers (API do Next) — CONCLUÍDA
Todas as rotas estão implementadas e autenticadas de verdade. Pendências conhecidas:
- **Execução dentro do request**: `POST /api/analyses` processa a análise no próprio
  request. Para períodos longos isso pode estourar o tempo máximo do provedor de
  deploy; `analyses.status`/`progressPct` e `?process=false` já existem para a
  migração à fila da Fase 4.
- **Testes de rota** (com banco) ainda não escritos — ver Fase 7. Hoje a cobertura
  automatizada é do motor puro (`core` + `analysis`); as rotas foram exercitadas
  manualmente via HTTP.

### ✅ Fase 2.5 — shadcn/ui — CONCLUÍDA

`npx shadcn@latest init` com **Base UI** (não Radix) — desde julho/2026 é o
default da própria ferramenta (preset `base-nova`). Diferença que vale
lembrar: componentes Base UI usam a prop **`render`**, não `asChild` do
Radix — ex. `<Button nativeButton={false} render={<Link href="..." />}>`
(o `nativeButton={false}` é necessário sempre que o alvo não é um `<button>`
nativo, senão o console avisa sobre semântica de acessibilidade perdida). Os
`Select` também precisam do prop `items` (mapa valor→rótulo) para o trigger
mostrar o rótulo em vez do valor bruto — sem isso, um select como
`dojiPolicy` mostraria "count_as_loss" na tela em vez de "Contar como
derrota".

### ✅ Fase 3 — Motor de Backtest cronológico — CONCLUÍDA

`src/lib/backtest/` — mesma separação pura/serviço já usada na Fase 2:

| Arquivo | Responsabilidade |
|---|---|
| `run-backtest.ts` | **Puro**: recebe `Candle[]` + o escopo (herdado da Analysis) + config, devolve operações + métricas. Sem banco, sem HTTP |
| `backtest-service.ts` | Carrega candles via `DbCandleProvider`, resolve o escopo pela `AnalysisConfiguration` de origem, chama `runBacktest`, persiste `backtest_operations` e atualiza `backtests.status`/`summary` |

**Mecânica redesenhada em conjunto com o usuário** — a primeira versão
perseguia a perda no candle seguinte do mesmo horário; não era isso que
fazia sentido pro caso de uso real. Como funciona hoje:

- **A cada dia simulado, o motor refaz o ranking do zero** — mesma lógica da
  Analysis (`analyzeAllSlots`, extraída de `run-analysis.ts` para ser
  reaproveitada aqui), usando **só candles anteriores àquele dia** (rolling,
  nunca olha o futuro) e os mesmos limiares (`minRepetitionPct`,
  `minValidDays`) da análise de origem dos horários escolhidos.
- **Pega os top N do dia** (N = quantidade de horários que o usuário
  selecionou na tela de ranking — não os horários literais, que podem não
  ser mais os melhores dia após dia) e ordena por horário **crescente**: essa
  é a escada do Martingale daquele dia especificamente.
- **O Martingale persegue no PRÓXIMO HORÁRIO DA ESCADA, não no candle
  seguinte do mesmo horário nem no dia seguinte**: entra no horário mais cedo
  (nível 0); se perder, tenta o segundo horário mais cedo da escada (nível 1,
  com o valor de recuperação); e assim por diante até vencer ou esgotar a
  escada do dia. Uma operação = **um dia inteiro** (no máximo 1 por dia), não
  mais uma por horário selecionado.
- Se num dia específico nem todos os N horários selecionados forem elegíveis
  (amostra ainda insuficiente para algum), a escada daquele dia fica menor —
  usa o que houver, nunca inventa horário.
- Se faltar o candle de algum horário da escada naquele dia (gap de dados), o
  **dia inteiro é descartado** (não fabrica resultado parcial).
- **DOJI no candle que resolveria a operação**: `dojiPolicy` decide —
  `ignore` descarta o dia, `count_as_tie` fecha com lucro zero,
  `count_as_loss` conta como derrota normal (segue pro próximo horário da
  escada).
- `maxExposureLimit` recusa abrir a operação do dia se o custo total da
  escada ultrapassar o limite. (`dailyLossLimit`/`maxOperationsPerDay` saíram
  do desenho — com no máximo 1 operação por dia, os dois ficaram redundantes
  com `maxExposureLimit`.)
- Se a banca atual não suporta mais o cronograma do dia
  (`MartingaleValidationError`), o dia é pulado, não derruba o backtest.

**API**: `patternResultIds` precisam vir todos da **mesma análise**
(validado na criação — é de lá que vem o escopo reaproveitado a cada dia).
`martingaleLevels` não é mais informado pelo usuário: é derivado
(`patternResultIds.length - 1`). Rotas `GET /api/backtests/:id` (detalhe +
`summary`) e `GET /api/backtests/:id/operations` (paginada, filtra por
resultado) inalteradas.

**Testes**: 13 em `run-backtest.test.ts` (70 no total) — cascata entre
horários diferentes (vence no segundo, não no primeiro), escada ordenada por
horário e não pela força do ranking, esgotamento da escada, menos elegíveis
que o selecionado, nenhum elegível, gap de dados descarta o dia, as 3
políticas de DOJI, `contrarian`, não-olhar-o-futuro, `maxExposureLimit` e
agregação por símbolo/horário/dia da semana/mês.

**Verificado com dados reais**: EUR/USD 15m, 4 horários selecionados
(contrarian, payout 85%, banca R$1.000) contra o Neon real — 10 operações em
15 dias simulados, banca final R$957,87. Confirmação mais importante: os
horários que aparecem no resultado (`02:45`, `04:15`, `09:30`...) são
**diferentes** dos 4 horários originalmente selecionados (`20:45`, `23:45`,
`21:45`, `19:15`) — prova que a redescoberta diária está de fato substituindo
horários por outros melhores, não fixando a seleção inicial. Um dia específico
(08/07) mostrou a escada completa sendo esgotada (4 níveis, a última tentativa
resolvendo em DOJI contado como derrota) com a perda batendo exatamente com a
exposição acumulada do nível 3.

### Fase 4 — Processamento assíncrono
Sem Celery/Redis nesta stack: usar **Vercel Queues / Inngest / Trigger.dev**
(ou, se preferir algo mais simples de operar, um cron job + tabela de jobs
como já modelada em `import_jobs`/`analyses.status`/`backtests.status`) para
importações e backtests longos, com progresso consultável pelo frontend via
polling (`TanStack Query` com `refetchInterval`).

### ✅ Fase 5 — Frontend (as 16 telas) — CONCLUÍDA

Next.js App Router + Tailwind + shadcn/ui (Base UI) + TanStack Query +
React Hook Form + Zod + Recharts, consumindo as rotas das Fases 2 e 3.

**Rotas de API que faltavam e foram criadas nesta fase** (schema já existia
desde a Fase 1, só não tinham Route Handler): `GET /api/currency-pairs`
(lista pares com contagem de candles), `GET /api/data-providers`,
`POST`/`GET /api/bankroll-configurations` + `DELETE /api/bankroll-configurations/:id`.

**Estrutura**:

| Peça | O que é |
|---|---|
| `src/lib/api-client/` | Cliente HTTP tipado por recurso, um arquivo por domínio (`analyses.ts`, `backtests.ts`, `pattern-results.ts`, `candles.ts`, `martingale.ts`, `bankroll-configurations.ts`, `currency-pairs.ts`, `data-providers.ts`), cada um exportando hooks do TanStack Query (`useAnalyses`, `useCreateBacktest` etc.) |
| `src/lib/format.ts` | Formatação de exibição (moeda, %, data) — única camada onde `string` da API vira `Number`, nunca para cálculo |
| `src/components/providers.tsx` | `QueryClientProvider` + `TooltipProvider` + `Toaster` (sonner) |
| `src/app/(app)/layout.tsx` | Shell autenticado: sidebar + header, redireciona para `/` sem sessão |
| `src/components/app-sidebar.tsx`, `user-menu.tsx` | Navegação lateral e menu do usuário (avatar, configurações, sair) |

**As 16 telas** (rotas dentro do grupo `(app)`, exceto login que é `/`):
`/` (login), `/dashboard`, `/import/csv`, `/import/yahoo`, `/data-providers`,
`/analyses/new`, `/analyses`, `/analyses/[id]` (tabs "Ranking de padrões" +
"Configuração" — cobre os itens 6 e 7 da lista confirmada com o usuário),
`/backtests/new` (recebe `?patternResultIds=` vindo do botão "Criar backtest
com selecionados" no ranking), `/backtests`, `/backtests/[id]` (tabs "Resumo"
com gráficos Recharts por horário/dia da semana/par/mês + "Operações"),
`/tools/martingale-calculator`, `/bankroll-configurations`, `/settings`.

**Verificado visualmente, não só compilado**: como o projeto não tinha
Playwright, instalei temporariamente (`--no-save`, removido ao final) e tirei
screenshots reais de cada grupo de telas contra o Neon real, autenticado com
uma sessão assinada manualmente (mesma técnica da Fase de autenticação),
checando o console por erros a cada passo. Isso pegou 3 problemas reais antes
de generalizar o padrão para as 16 telas:
1. `Button`/`SidebarMenuButton`/`DropdownMenuItem` com `asChild` (Radix) não
   compilava — Base UI usa `render`.
2. `Button render={<Link .../>}` disparava aviso de acessibilidade no console
   (`nativeButton` esperado `true` por padrão) — corrigido com
   `nativeButton={false}`.
3. `Select` sem a prop `items` mostrava o valor bruto (`same_direction`) em
   vez do rótulo (`Mesma direção`) no trigger.

A calculadora de Martingale testada pela UI reproduziu os mesmos valores do
enunciado (Martingale 1 = R$7,06, Martingale 2 = R$15,37) que já eram
verificados desde a Fase 1 — agora também pela ponta do navegador. O
dashboard, o ranking de padrões e o detalhe do backtest renderizaram
corretamente os dados reais da época (75 operações, R$1.070,17 de banca
final). *Números históricos desta verificação específica — o motor de
backtest foi redesenhado depois (ver seção da Fase 3 acima); a mecânica de
renderização da tela não mudou, só o cálculo por trás.*

**Simplificações conscientes** (não pedidas, ficam para depois se fizerem
falta): a Calculadora de Entradas continua sem histórico persistido (só
calcula, não grava em `martingale_calculations`/`martingale_levels`, que
existem no schema mas não têm rota ainda); "Configurações" da conta é
somente leitura (nome/e-mail vêm do Google, não há edição de perfil); não há
paginação nas tabelas de listagem (analyses/backtests) além do `limit`/`offset`
que a API já suporta.

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
- **Autenticação real (Auth.js v5 + Google)**: ver seção própria acima.
- **Motor de backtest cronológico (Fase 3, mecânica atual — escada entre
  horários)**: EUR/USD 15m real, 4 horários selecionados (contrarian, payout
  85%, banca R$1.000) → 10 operações em 15 dias simulados, banca final
  R$957,87. Confirmado que os horários que aparecem no resultado são
  diferentes dos 4 originalmente selecionados (a redescoberta diária está
  de fato trocando por horários melhores) — ver seção própria acima.
- **Frontend, as 16 telas (Fase 5)**: screenshots reais (não só compilação) de
  cada tela contra o Neon, autenticado — dashboard, formulários, multi-select
  de pares, ranking de padrões, gráficos do backtest, calculadora reproduzindo
  R$7,06/R$15,37 do enunciado pela UI, dialog de configuração de banca criando
  e persistindo de verdade. Zero erros de console. Ver seção própria acima.
- `npm run test` → 70 testes. `npm run typecheck` → sem erros. `npm run build` →
  limpo, 30 rotas (16 telas + 14 rotas de API).

**Segurança**: o projeto não tinha `.gitignore` até a sessão que implementou o
Yahoo Finance — o `.env` com a connection string real do Neon estava exposto
para `git add` (nunca houve commit, então nada vazou). Criado antes de
qualquer outra alteração.

**Ainda não verificado**: login real via Google no navegador (só um humano
pode clicar no consentimento — verifiquei o resto do caminho, tanto da API
quanto das 16 telas, com uma sessão assinada manualmente, ver seção de
autenticação); comportamento do Yahoo Finance em produção sob uso sustentado
(é endpoint não-oficial — risco de bloqueio/rate limit não testado); testes
de rota com banco e testes de componente no frontend (ver Fase 7) — tudo foi
exercitado manualmente contra o Neon real, não há suíte automatizada de
integração/componente ainda.

## Próximos passos sugeridos

1. Testar o login real com Google no navegador para fechar a última ponta da
   autenticação (criação de usuário novo pelo fluxo OAuth de verdade) — agora
   dá pra fazer isso direto pela tela de login em vez de só pela API.
2. Persistir o histórico da Calculadora de Entradas (`martingale_calculations`/
   `martingale_levels` já existem no schema, só falta a rota) — ou Fase 4
   (processamento assíncrono) se análises/backtests maiores começarem a
   esbarrar no tempo máximo de execução do request.
3. Fase 6 (deploy) — a aplicação já está funcionalmente completa
   (importar → analisar → ranquear → simular → visualizar).
