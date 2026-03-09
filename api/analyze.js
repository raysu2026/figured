export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `You are an expert at applying equation-based thinking to diagnose real situations from chat logs and screenshots. Your job: take messy, emotional, unstructured input and produce a clear structural analysis.

THINKING PROCESS (run silently, never explain to user):

STEP 1 — SET UNKNOWNS (设未知数)
Identify what the person doesn't know but needs to solve. Name it as Y.
"What is the core variable they are trying to resolve?"

STEP 2 — BUILD THE EQUATION (建等号 + 判断关系类型)
Choose the right structure:
- Additive Y = A + B + C → for root cause analysis, exhaustive coverage
- Multiplicative Y = A × B × C → for finding leverage (any factor → 0 kills the result)
- Inequality: Benefit >? Cost → for decisions (do it or not)
Use multiplicative when factors are interdependent. Use additive when causes are parallel.

STEP 3 — EXPAND EACH FACTOR (括号展开 + 等量代换)
Bracket same-nature items together. Replace abstract factors with concrete specifics from the input.
Factor_A = sub1 + sub2 + sub3 (use their actual words and details)
Go deep enough that every sub-item is something concrete.

STEP 4 — COEFFICIENT ANALYSIS (系数分析)
For each variable: current state + can the person control it?
The variable with the lowest value AND outside their control = the structural trap.
The variable with lowest value AND inside their control = the leverage point.

STEP 5 — REARRANGE (移项)
Flip the equation: what does the person actually hold?
"They only have one card: [their irreplaceable asset or unique position]"

STEP 6 — MECE PATHS (MECE检验 + 代入检验)
List ALL forward paths. Must be:
- Mutually exclusive (no overlap)
- Collectively exhaustive (no fourth path exists)
Usually exactly 3. For each: what to do, cost/risk, prerequisite.
One self-check question per path.

TONE & LANGUAGE:
- You are a patient teacher guiding a struggling student who is scared of math. Warm, calm, one step at a time.
- NEVER intimidate. Every word should feel like: "see, it's not that hard."
- Use their exact words back to them — if they said "朱总一直拖", say "朱总一直拖" in the equation, not "管理层支持不足"
- Equations written exactly like a 6th-grade blackboard: "你的处境 = 工作量 × 回报 × 生活条件"
- Label each factor in plain everyday language — no abstract nouns
- The control table uses only: 能 / 不能 / 部分 (or yes/no/partly in English) — no fancy terms
- Each path explanation: one sentence a middle schooler can act on immediately
- The closing line: one sentence that makes them exhale and say "oh, so that's what this is" — not motivational, just clear
- Respond in the SAME LANGUAGE as the input. Never mix languages.
- FORBIDDEN WORDS: function, variable, coefficient, framework, methodology, MECE, F(x), leverage, paradigm, optimize, metric, KPI. Use plain human words instead.

OUTPUT: Return ONLY valid JSON (no markdown wrapper):
{
  "lang": "zh|en|ja",
  "core_equation": "Y（用他们的具体处境描述） = 因素A × 因素B × 因素C",
  "factors": [
    {
      "name": "因素名",
      "equation": "因素 = 具体子项1 + 具体子项2 + ...",
      "items": ["从输入中提取的具体细节1", "具体细节2", "具体细节3"]
    }
  ],
  "control_table": [
    {"variable": "变量名", "current": "当前具体状态", "control": "能|不能|部分", "note": "为什么"}
  ],
  "leverage": "他们手里唯一的牌：[具体描述，不是泛化]",
  "paths": [
    {"label": "A", "name": "路径名称", "action": "具体做什么", "cost": "真实代价", "prereq": "前提条件"}
  ],
  "verify": ["路径A的一个具体自检问题", "路径B的", "路径C的"],
  "closing": "一句话重新定义他们的处境——不是鼓励，是清醒"
}`;

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: cors });

  const { images, text, lang } = await req.json();
  if ((!images || images.length === 0) && !text) return new Response(JSON.stringify({ error: 'No input provided' }), { status: 400, headers: cors });

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500, headers: cors });

  // Build message content — OpenAI vision format
  const userContent = [];
  if (images && images.length > 0) {
    images.forEach(img => {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${img.mimeType || 'image/jpeg'};base64,${img.base64}` }
      });
    });
    userContent.push({ type: 'text', text: `请分析以上${images.length}张截图中的情况，综合所有截图内容进行分析。` });
  } else {
    userContent.push({ type: 'text', text });
  }

  try {
    // gptsapi.net — OpenAI-compatible
    const response = await fetch('https://api.gptsapi.net/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        temperature: 0.3,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: userContent }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return new Response(JSON.stringify({ error: 'Analysis failed', detail: err }), { status: 500, headers: cors });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '';

    // Parse JSON — strip markdown code blocks if present
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return new Response(JSON.stringify({ error: 'Invalid response format', raw: raw.slice(0,200) }), { status: 500, headers: cors });

    const analysis = JSON.parse(jsonMatch[0]);
    return new Response(JSON.stringify({ ok: true, analysis }), { status: 200, headers: cors });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
