/**
 * POST /api/candles/import
 *
 * Recebe um CSV via multipart/form-data, faz o parse com o `CSVCandleProvider`
 * do motor de domínio e grava os candles em `candles` via Drizzle.
 *
 * Campos do FormData:
 *   file             (obrigatório) arquivo CSV
 *   dataProviderId   (opcional) id de um data_provider do usuário; se ausente,
 *                    um provider CSV padrão é criado/reutilizado
 *   source           (opcional) rótulo da origem gravado em candles.source
 *                    (default "csv_import")
 *
 * Cabeçalho obrigatório do CSV:
 *   symbol,timeframe,open_time,close_time,open,high,low,close,volume
 *
 * Duplicidade: o índice único (par, timeframe, open_time, source) faz o
 * ON CONFLICT DO NOTHING — reimportar o mesmo arquivo não duplica candles,
 * e a contagem de ignorados volta na resposta.
 *
 * O progresso fica registrado em `import_jobs`, já preparado para a Fase 4
 * (processamento assíncrono), quando o parse sairá do request.
 *
 * Para importar direto do Yahoo Finance (sem CSV), ver
 * POST /api/candles/import-yahoo.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { importJobs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { CSVCandleProvider } from "@/lib/core/data-provider";
import { requireUserId } from "@/lib/api/current-user";
import { ApiError, handleErrors, isUuid } from "@/lib/api/http";
import { persistImportedCandles, resolveDataProviderId } from "@/lib/db/persist-candles";

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

export async function POST(req: NextRequest) {
  return handleErrors(async () => {
    const userId = await requireUserId(req);

    const form = await req.formData().catch(() => null);
    if (!form) {
      throw new ApiError("Envie o arquivo como multipart/form-data.", 400);
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError("Campo 'file' (arquivo CSV) é obrigatório.", 400);
    }
    if (file.size === 0) {
      throw new ApiError("Arquivo CSV vazio.", 400);
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new ApiError(
        `Arquivo acima do limite de ${MAX_FILE_BYTES / 1024 / 1024} MB. Divida a importação em partes.`,
        413
      );
    }

    const sourceRaw = form.get("source");
    const sourceName = typeof sourceRaw === "string" && sourceRaw.trim() ? sourceRaw.trim() : "csv_import";
    const dataProviderId = await resolveDataProviderId(
      userId,
      form.get("dataProviderId"),
      "csv",
      "Importação CSV"
    );

    const candles = await new CSVCandleProvider(await file.text(), { sourceName }).loadCandles();
    const result = await persistImportedCandles({
      userId,
      dataProviderId,
      fileName: file.name,
      candles,
    });

    return NextResponse.json(result, { status: 201 });
  });
}

/** GET /api/candles/import?jobId=... — status de uma importação (polling da UI). */
export async function GET(req: NextRequest) {
  return handleErrors(async () => {
    const userId = await requireUserId(req);
    const jobId = new URL(req.url).searchParams.get("jobId");

    if (jobId) {
      if (!isUuid(jobId)) throw new ApiError("jobId inválido (esperado UUID).", 400);
      const [job] = await db
        .select()
        .from(importJobs)
        .where(and(eq(importJobs.id, jobId), eq(importJobs.userId, userId)))
        .limit(1);
      if (!job) throw new ApiError("Importação não encontrada.", 404);
      return NextResponse.json(job);
    }

    const jobs = await db
      .select()
      .from(importJobs)
      .where(eq(importJobs.userId, userId))
      .orderBy(importJobs.createdAt);
    return NextResponse.json({ items: jobs });
  });
}
