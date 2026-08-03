// Recalcula la fila agregada de `series` a partir del detalle real.
//
// Hasta ahora `series` era un dato independiente que venía del XLSX: se editaba el detalle
// (re_monthly, block_monthly) y el dashboard seguía enseñando las cifras viejas. De ahí venían
// todos los descuadres. A partir de aquí `series` es una vista derivada: la única fuente son
// las tablas de detalle, y esto se ejecuta cada vez que alguna cambia.
//
// Qué columna del XLSX alimenta cada agregado. Tiene que coincidir con los grupos de las páginas.
import { sql } from './db.js';

const GRUPOS = {
  // Bloque "patrimonial" (en la app, Financiero)
  inv_fin: [0, 1, 2, 10],        // cuentas Bankinter/Santander/Caixabank + Fondos
  empresas: [4, 12, 13],         // Valor Actual de startups + Rocketroi + WECITY
  // La columna 11 ("Variación") es de control y no suma. Las 3 y 5..9 son detalle de startups,
  // ya recogido en la 4: sumarlas sería contar dos veces.
  caja: [0, 1, 2, 3, 5, 6, 7, 9], // el AMEX (8) queda fuera: criterio del XLSX
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

// Suma las columnas indicadas de un bloque para un mes. Si no hay filas, devuelve null
// para poder distinguir "vale cero" de "no hay datos".
async function sumaBloque(mes, bloque, cols) {
  const rows = await sql`
    SELECT col, value FROM bellesguard.block_monthly
    WHERE block = ${bloque} AND month = ${mes}`;
  if (!rows.length) return null;
  const permitidas = cols === null ? null : new Set(cols);
  let t = 0;
  for (const r of rows) if (!permitidas || permitidas.has(Number(r.col))) t += Number(r.value) || 0;
  return num(t);
}

export async function recalcularMes(mes) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes || '')) return null;

  const [actualRow] = await sql`
    SELECT net, real_estate, patrimonial, empresas, inv_fin, caja, activos, debt, is_actual
    FROM bellesguard.series WHERE month = ${mes}`;

  const re = await sql`
    SELECT COALESCE(SUM(valor), 0) AS valor, COALESCE(SUM(hipoteca), 0) AS hipoteca, COUNT(*) AS n
    FROM bellesguard.re_monthly WHERE month = ${mes}`;

  const hayRe = Number(re[0]?.n) > 0;
  const debt = hayRe ? num(re[0].hipoteca) : num(actualRow?.debt);
  const real_estate = hayRe ? num(Number(re[0].valor) + Number(re[0].hipoteca)) : num(actualRow?.real_estate);

  const invFin = await sumaBloque(mes, 'patrimonial', GRUPOS.inv_fin);
  const empresasB = await sumaBloque(mes, 'patrimonial', GRUPOS.empresas);
  const cajaB = await sumaBloque(mes, 'caja', GRUPOS.caja);
  const activosB = await sumaBloque(mes, 'activos', null);

  const inv_fin = invFin === null ? num(actualRow?.inv_fin) : invFin;
  const empresas = empresasB === null ? num(actualRow?.empresas) : empresasB;
  const caja = cajaB === null ? num(actualRow?.caja) : cajaB;
  const activos = activosB === null ? num(actualRow?.activos) : activosB;

  const patrimonial = num(empresas + inv_fin);
  const net = num(real_estate + patrimonial + caja + activos);
  const is_actual = actualRow ? !!actualRow.is_actual : true;

  await sql`
    INSERT INTO bellesguard.series
      (month, net, real_estate, patrimonial, empresas, inv_fin, caja, activos, debt, is_actual, updated_at)
    VALUES (${mes}, ${net}, ${real_estate}, ${patrimonial}, ${empresas}, ${inv_fin},
            ${caja}, ${activos}, ${debt}, ${is_actual}, now())
    ON CONFLICT (month) DO UPDATE SET
      net = EXCLUDED.net, real_estate = EXCLUDED.real_estate, patrimonial = EXCLUDED.patrimonial,
      empresas = EXCLUDED.empresas, inv_fin = EXCLUDED.inv_fin, caja = EXCLUDED.caja,
      activos = EXCLUDED.activos, debt = EXCLUDED.debt, updated_at = now()`;

  return { month: mes, net, real_estate, patrimonial, empresas, inv_fin, caja, activos, debt };
}

// Varios meses de una tacada, sin repetir.
export async function recalcularMeses(meses) {
  const unicos = [...new Set((meses || []).filter(Boolean))].sort();
  const out = [];
  for (const m of unicos) {
    const r = await recalcularMes(m);
    if (r) out.push(r);
  }
  return out;
}
