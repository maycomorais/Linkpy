/**
 * LinkPY — Supabase Edge Function: client-proxy v2.0.0
 *
 * Novidades v2.0.0:
 *  ✅ Verifica campo `ativo` antes de servir qualquer requisição
 *  ✅ Auto-suspende clientes com vencimento > 5 dias em atraso
 *  ✅ Retorna 503 com mensagem amigável para clientes suspensos
 *
 * Deploy: supabase functions deploy client-proxy
 *
 * Variáveis de ambiente (Dashboard → Settings → Edge Functions):
 *   ADMIN_SUPABASE_URL     = URL do projeto admin
 *   ADMIN_SERVICE_ROLE_KEY = Service Role Key do projeto admin
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────
const GRACE_DAYS = 5;  // dias de carência após vencimento

const ALLOWED_ORIGINS = [
  "https://sushitopy.com",
  // Adicione os domínios dos seus clientes:
  // "https://cliente2.com.py",
];

const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? "",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
});

const ALLOWED_METHODS = ["select", "insert", "update", "upsert"];
const ALLOWED_TABLES_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────
function errorResponse(status: number, message: string, origin: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

/** Retorna 503 com HTML amigável para o usuário final do cliente */
function suspendedResponse(origin: string) {
  const html = `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Sistema Temporariamente Indisponível</title>
  <style>
    * { box-sizing: border-box; margin: 0; }
    body {
      font-family: system-ui, sans-serif;
      background: #f8fafc;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 3rem 2.5rem;
      max-width: 460px;
      text-align: center;
      box-shadow: 0 10px 40px rgba(0,0,0,.08);
      border-top: 5px solid #dc2626;
    }
    .icon  { font-size: 3.5rem; margin-bottom: 1.5rem; }
    h1     { font-size: 1.35rem; font-weight: 800; color: #1e293b; margin-bottom: .75rem; }
    p      { font-size: .9rem; color: #64748b; line-height: 1.6; margin-bottom: 1.5rem; }
    .badge {
      display: inline-block;
      background: #fef2f2;
      color: #b91c1c;
      border: 1px solid #fecaca;
      padding: .4rem 1rem;
      border-radius: 99px;
      font-size: .75rem;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⚙️</div>
    <h1>Sistema em Manutenção</h1>
    <p>Este sistema está temporariamente fora do ar. Por favor, entre em contato com o suporte para mais informações.</p>
    <span class="badge">Indisponível</span>
  </div>
</body>
</html>`;

  // Se a requisição veio da API (JSON), retorna JSON. Se veio do browser, retorna HTML.
  // A edge function sempre recebe POST de API, então retornamos JSON mesmo assim.
  return new Response(
    JSON.stringify({ error: "Serviço temporariamente indisponível. Entre em contato com o suporte." }),
    {
      status: 503,
      headers: {
        ...corsHeaders(origin),
        "Content-Type": "application/json",
        "Retry-After": "3600",
      },
    }
  );
}

/** Verifica se o cliente está inadimplente além do período de carência */
function isInadimplente(vencimentoMensalidade: string | null): boolean {
  if (!vencimentoMensalidade) return false;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const venc = new Date(vencimentoMensalidade + "T00:00:00");
  const diasAtraso = Math.floor((hoje.getTime() - venc.getTime()) / 86_400_000);
  return diasAtraso > GRACE_DAYS;
}

// ─────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────
serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";

  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return errorResponse(405, "Method not allowed", origin);
  }

  try {
    // 1. Parse body
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return errorResponse(400, "Body inválido", origin);
    }

    const { token, table, method, filters = [], data, limit, order } = body;

    // 2. Validações básicas
    if (!token || typeof token !== "string") {
      return errorResponse(401, "Token ausente ou inválido", origin);
    }
    if (!table || !ALLOWED_TABLES_PATTERN.test(table)) {
      return errorResponse(400, "Tabela inválida", origin);
    }
    if (!method || !ALLOWED_METHODS.includes(method)) {
      return errorResponse(400, `Método inválido. Use: ${ALLOWED_METHODS.join(", ")}`, origin);
    }

    // 3. Buscar cliente no banco admin
    const adminClient = createClient(
      Deno.env.get("ADMIN_SUPABASE_URL")!,
      Deno.env.get("ADMIN_SERVICE_ROLE_KEY")!
    );

    const { data: clientData, error: lookupError } = await adminClient
      .from("clientes")
      .select("supabase_url, supabase_anon_key, nome_empresa, ativo, suspenso_auto, vencimento_mensalidade")
      .eq("client_token", token)
      .not("supabase_url", "is", null)
      .not("supabase_anon_key", "is", null)
      .single();

    if (lookupError || !clientData) {
      return errorResponse(401, "Token inválido ou cliente não encontrado", origin);
    }

    // 4. Verificar se está ativo
    if (!clientData.ativo) {
      return suspendedResponse(origin);
    }

    // 5. Verificar inadimplência (auto-suspend)
    if (isInadimplente(clientData.vencimento_mensalidade)) {
      // Suspende automaticamente no banco admin
      await adminClient
        .from("clientes")
        .update({ ativo: false, suspenso_auto: true })
        .eq("client_token", token);

      console.warn(`[client-proxy] Auto-suspenso por inadimplência: ${clientData.nome_empresa}`);
      return suspendedResponse(origin);
    }

    // 6. Criar client para o banco do cliente
    const clientDb = createClient(clientData.supabase_url, clientData.supabase_anon_key);

    // 7. Executar a query
    let query: any;

    switch (method) {
      case "select": {
        query = clientDb.from(table).select(body.columns ?? "*");

        if (Array.isArray(filters)) {
          for (const f of filters) {
            if (f.column && f.operator && f.value !== undefined) {
              query = query.filter(f.column, f.operator, f.value);
            }
          }
        }

        const safeLimit = typeof limit === "number" && limit > 0 && limit <= 1000 ? limit : 500;
        query = query.limit(safeLimit);

        if (order?.column) {
          query = query.order(order.column, { ascending: order.ascending ?? true });
        }
        break;
      }

      case "insert": {
        if (!data) return errorResponse(400, "Campo 'data' obrigatório para insert", origin);
        query = clientDb.from(table).insert(data).select();
        break;
      }

      case "update": {
        if (!data) return errorResponse(400, "Campo 'data' obrigatório para update", origin);
        if (!filters || filters.length === 0) {
          return errorResponse(400, "Filtros obrigatórios para update (segurança)", origin);
        }
        query = clientDb.from(table).update(data);
        for (const f of filters) {
          query = query.filter(f.column, f.operator, f.value);
        }
        query = query.select();
        break;
      }

      case "upsert": {
        if (!data) return errorResponse(400, "Campo 'data' obrigatório para upsert", origin);
        query = clientDb.from(table).upsert(data).select();
        break;
      }

      default:
        return errorResponse(400, "Método não suportado", origin);
    }

    const { data: result, error: queryError } = await query;

    if (queryError) {
      return errorResponse(500, queryError.message, origin);
    }

    return new Response(JSON.stringify({ data: result }), {
      status: 200,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[client-proxy] Erro interno:", err);
    return errorResponse(500, "Erro interno do servidor", origin);
  }
});
