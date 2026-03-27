/**
 * LinkPY — Supabase Edge Function: client-proxy
 * 
 * Deploy: supabase functions deploy client-proxy
 * 
 * Como funciona:
 *   1. Site do cliente envia { token, table, method, ...params }
 *   2. Esta função busca as credenciais reais no banco admin
 *   3. Executa a query no banco do cliente
 *   4. Retorna o resultado — a anon_key nunca chega ao browser do cliente
 *
 * Variáveis de ambiente necessárias (configurar no Dashboard Supabase):
 *   ADMIN_SUPABASE_URL     = URL do projeto admin (LinkPY)
 *   ADMIN_SERVICE_ROLE_KEY = Service Role Key do projeto admin
 *                            (NÃO é a anon key — esta chave fica 100% server-side)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────
// CORS — ajuste para os domínios dos seus clientes
// ─────────────────────────────────────────
const ALLOWED_ORIGINS = [
  "https://sushitopy.com",
  // Adicione os domínios dos seus clientes aqui:
  // "https://cliente.com.py",
];

const corsHeaders = (origin) => ({
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
});

// ─────────────────────────────────────────
// MÉTODOS PERMITIDOS (whitelist de segurança)
// ─────────────────────────────────────────
const ALLOWED_METHODS = ["select", "insert", "update", "upsert"];
const ALLOWED_TABLES_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/; // apenas nomes válidos de tabela

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
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  try {
    // 1. Parse do body
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return errorResponse(400, "Body inválido", origin);
    }

    const { token, table, method, filters = [], data, limit, order } = body;

    // 2. Validações de entrada
    if (!token || typeof token !== "string") {
      return errorResponse(401, "Token ausente ou inválido", origin);
    }

    if (!table || !ALLOWED_TABLES_PATTERN.test(table)) {
      return errorResponse(400, "Tabela inválida", origin);
    }

    if (!method || !ALLOWED_METHODS.includes(method)) {
      return errorResponse(400, `Método inválido. Use: ${ALLOWED_METHODS.join(", ")}`, origin);
    }

    // 3. Buscar credenciais do cliente no banco admin
    const adminClient = createClient(
      Deno.env.get("ADMIN_SUPABASE_URL")!,
      Deno.env.get("ADMIN_SERVICE_ROLE_KEY")!
    );

    const { data: clientData, error: lookupError } = await adminClient
      .from("clientes")
      .select("supabase_url, supabase_anon_key, nome_empresa")
      .eq("client_token", token)
      .not("supabase_url", "is", null)
      .not("supabase_anon_key", "is", null)
      .single();

    if (lookupError || !clientData) {
      return errorResponse(401, "Token inválido ou cliente não encontrado", origin);
    }

    // 4. Criar client para o banco do cliente
    const clientDb = createClient(clientData.supabase_url, clientData.supabase_anon_key);

    // 5. Executar a query
    let query;

    switch (method) {
      case "select": {
        query = clientDb.from(table).select(body.columns ?? "*");
        
        // Aplicar filtros: [{ column, operator, value }]
        if (Array.isArray(filters)) {
          for (const f of filters) {
            if (f.column && f.operator && f.value !== undefined) {
              query = query.filter(f.column, f.operator, f.value);
            }
          }
        }

        if (typeof limit === "number" && limit > 0 && limit <= 1000) {
          query = query.limit(limit);
        } else {
          query = query.limit(500); // limite padrão de segurança
        }

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

function errorResponse(status, message, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}
