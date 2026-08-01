import { requireAuth, json } from './_lib/auth.js';
import { sql, sessionEpoch } from './_lib/db.js';

export const config = { runtime: 'edge' };

const MODEL = 'claude-sonnet-5';

const BASE = `Eres el analista del family office de Nacho Rodés (Tartera). Trabajas sobre su patrimonio real.

CÓMO LEER LOS DATOS — importante, no te equivoques con esto:
- "inmob_equity" ya viene NETO de hipoteca: es equity, no valor de mercado. La deuda inmobiliaria está en "deuda" y desglosada por propiedad.
- "neto" = inmob_equity + patrimonial + caja + activos. Es el patrimonio neto agregado.
- "patrimonial" = empresas + inv_fin (participaciones en compañías + inversiones financieras). En la app este bloque se llama "Financiero": úsalo así al hablar con él, nunca "patrimonial".
- Los meses con real=0 son PROYECCIÓN con crecimiento plano hardcodeado, no un modelo. No los trates como previsión fiable ni saques conclusiones de futuro con ellos.
- Las inversiones financieras son el colchón de liquidez principal.

CONTEXTO QUE YA SABES:
- Los saltos históricos del patrimonio vienen de eventos puntuales (revalorizaciones de inmuebles, entrada de la valoración de Rocketroi, markup de la cartera de startups), no de compounding orgánico. Nunca presentes un CAGR histórico como capacidad de crecimiento recurrente sin decir de dónde sale.
- La compra de Tartera se cerró en 2026 con ~124k€ de costes no recuperables (IVA, notaría, retenciones). Es destrucción real de patrimonio y explica buena parte del bajo crecimiento de 2026. Aísla ese tipo de costes al comentar el crecimiento anual.

CÓMO RESPONDER:
- En español, directo y sin rodeos. Nada de frameworks financieros genéricos ni consejos de manual.
- Cifras concretas con el dato que las respalda. Si algo no se puede saber con estos datos, dilo en vez de estimarlo por encima.
- Breve por defecto. Si piden análisis, profundiza; si preguntan un dato, da el dato.
- No eres asesor financiero y no das recomendaciones de inversión. Analizas lo que hay.`;

const MODES = {
  chat: 'Responde a lo que te pregunte sobre estas cifras.',
  commentary:
    'Escribe el comentario del mes en curso: 2 o 3 párrafos cortos explicando qué ha movido el patrimonio respecto al mes anterior y respecto al cierre de diciembre. Señala el driver principal de cada movimiento. Sin titulares ni listas, prosa seguida.',
  anomalies:
    'Revisa los datos buscando problemas: descuadres entre agregados y componentes, saltos mensuales sin explicación aparente, valores planos que sugieran que no se están actualizando, y cualquier cosa que no cuadre. Lista solo lo que encuentres de verdad, con el mes y la cifra. Si algo está bien, no lo menciones.',
};

export default async function handler(request) {
  const denied = await requireAuth(request, process.env, await sessionEpoch());
  if (denied) return denied;
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'missing_api_key' }, 500);

  let mode = 'chat';
  let messages = [];
  try {
    ({ mode = 'chat', messages = [] } = await request.json());
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  if (!MODES[mode]) return json({ error: 'bad_mode' }, 400);

  const clean = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));

  if (mode !== 'chat' && !clean.length) clean.push({ role: 'user', content: MODES[mode] });
  if (!clean.length) return json({ error: 'no_messages' }, 400);

  const [rows, properties, metaRows] = await Promise.all([
    sql`SELECT month, net, real_estate, patrimonial, empresas, inv_fin, caja, activos, debt, is_actual
        FROM bellesguard.series ORDER BY month`,
    sql`SELECT name, use_type, value, debt FROM bellesguard.properties ORDER BY sort, id`,
    sql`SELECT key, value FROM bellesguard.meta`,
  ]);

  const meta = Object.fromEntries(metaRows.map((r) => [r.key, r.value]));
  const actual = rows.filter((r) => r.is_actual);
  const R = Math.round;

  // CSV compacto: mucho más barato en tokens que JSON.
  const csv = [
    'mes,neto,inmob_equity,patrimonial,empresas,inv_fin,caja,activos,deuda,real',
    ...rows.map(
      (r) =>
        `${r.month},${R(r.net)},${R(r.real_estate)},${R(r.patrimonial)},${R(r.empresas)},${R(r.inv_fin)},${R(
          r.caja
        )},${R(r.activos)},${R(r.debt)},${r.is_actual ? 1 : 0}`
    ),
  ].join('\n');

  const props = properties
    .map((p) => `${p.name} (${p.use_type}): valor ${R(p.value)}, deuda ${R(p.debt)}, equity ${R(p.value + p.debt)}`)
    .join('\n');

  const system = `${BASE}

MES EN CURSO: ${meta.current_month || (actual.at(-1) || {}).month || 'n/d'}
SUELDO NETO ANUAL: ${meta.lifestyle_cost || '100000'} € (la "cobertura laboral" son los años que la liquidez cubre ese sueldo)

CARTERA INMOBILIARIA:
${props}

SERIE MENSUAL (euros; real=1 dato real, real=0 proyección):
${csv}

TAREA: ${MODES[mode]}`;

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.MODEL || MODEL,
      max_tokens: 2000,
      system,
      messages: clean,
      stream: true,
    }),
  });

  if (!upstream.ok) {
    console.error('anthropic', upstream.status, (await upstream.text()).slice(0, 500));
    // No reenviamos el cuerpo del error: puede llevar pistas de la key.
    return json({ error: 'upstream_error', status: upstream.status }, 502);
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
