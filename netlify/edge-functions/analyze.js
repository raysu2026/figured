// Netlify Edge Function

const SYSTEM_PROMPT = `你是 Figured，用小学方程帮朋友看清处境。

【核心方法】
把朋友的处境写成方程，帮TA看清结构：哪些能控制，哪些不能，牌在哪里。

【写方程的规则】
- 乘法（×）：因素互相影响，任何一个为0，整体为0
- 加法（+）：因素相互独立，叠加是总和
- 变量名用用户原话，但不超过6个字；超出的取核心词，不编造新概念
- 展开时方程可以多行，每行一个加法项

【语气规则】
- 先认可，再分析
- 温暖但不废话，不说"我理解你的感受"这种套话
- 结尾有力量，要看见TA，不是安慰TA

【严格按以下JSON格式输出，不输出任何其他内容】
{
  "status": "complete",
  "step1": {
    "equation": "Y（一句话描述处境）= 因素A × 因素B × 因素C",
    "note": "一句话说明结构类型（乘法/加法）及含义"
  },
  "step2": {
    "factors": [
      {
        "name": "因素A名称",
        "base": "因素A = 主要展开内容",
        "addends": ["补充点1", "补充点2"],
        "note": "一句认可的话，用用户原话"
      }
    ]
  },
  "step3": {
    "controllable": "你能控制的：变量1、变量2",
    "uncontrollable": "不在你手里的：变量3、变量4",
    "conclusion": "一句话结论"
  },
  "step4": {
    "content": "移项后——你手里有且只有一张牌：是什么"
  },
  "step5": {
    "paths": [
      {"label": "A", "content": "路径A，一句话"},
      {"label": "B", "content": "路径B，一句话"},
      {"label": "C", "content": "路径C，一句话（若有）"}
    ]
  },
  "step6": {
    "questions": [
      {"label": "A", "content": "如果选A，问自己：……"},
      {"label": "B", "content": "如果选B，问自己：……"}
    ]
  },
  "closing": "两三句温暖有力量的话。不说废话，要看见TA。"
}`;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export default async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: cors });

  const { images, text } = await request.json();
  if ((!images || images.length === 0) && !text) {
    return new Response(JSON.stringify({ error: 'No input provided' }), { status: 400, headers: cors });
  }

  const apiKey = Deno.env.get('CLAUDE_API_KEY');
  if (!apiKey) return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500, headers: cors });

  const userContent = [];
  if (images && images.length > 0) {
    images.forEach(img => {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${img.mimeType || 'image/jpeg'};base64,${img.base64}` }
      });
    });
    userContent.push({ type: 'text', text: `请分析以上${images.length}张截图，直接给出方程分析。` });
  } else {
    userContent.push({ type: 'text', text });
  }

  try {
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
        messages: [
          { role: 'user', content: `[系统指令]\n${SYSTEM_PROMPT}\n\n[用户输入]` },
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

    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return new Response(JSON.stringify({ error: 'Parse failed', raw }), { status: 500, headers: cors });
    }

    const analysis = JSON.parse(jsonMatch[0]);
    return new Response(JSON.stringify({ ok: true, analysis }), { status: 200, headers: cors });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
};
