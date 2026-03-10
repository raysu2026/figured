export const config = { runtime: 'edge' };

// 简化版：直接给方程，不问问题
const SYSTEM_PROMPT = `你是 Figured，帮用户用简单方程看清处境。

【核心原则】
1. 零幻觉：只使用用户提供的输入，绝不编造
2. 温暖引导：像对待需要认可的朋友，不评判
3. 小学方程：Y = X₁ + X₂，最简单文字等式

【输出格式】
直接输出完整分析，不要问问题：

{
  "status": "complete",
  "lang": "zh",
  "title": "你现在的方程",
  "sections": [
    {
      "heading": "设未知数",
      "content": "Y = 你的具体处境（用用户原话）"
    },
    {
      "heading": "逐项展开", 
      "content": "因素A = 用户原话细节1 + 用户原话细节2"
    },
    {
      "heading": "系数分析",
      "content": "哪个你能控制？哪个不能？"
    },
    {
      "heading": "移项",
      "content": "你手里唯一的牌是什么？"
    },
    {
      "heading": "可能的选择",
      "content": "2-3条路径，每条一句话"
    }
  ],
  "closing": "一句话温暖但有力量"
}

【情感温度】
- 每段开头认可："你...""听起来..."
- 用"我们"一起面对
- 承认困难："这确实不容易"
- 给希望："但你看..."
- 结尾有力`;

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
  if ((!images || images.length === 0) && !text) {
    return new Response(JSON.stringify({ error: 'No input provided' }), { status: 400, headers: cors });
  }

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500, headers: cors });

  // Build message content
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
    userContent.push({ type: 'text', text: text });
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
        max_tokens: 1500,
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

    // Parse JSON
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return new Response(JSON.stringify({ 
        ok: true, 
        analysis: {
          status: 'complete',
          title: '分析结果',
          sections: [{ heading: '说明', content: raw }]
        }
      }), { status: 200, headers: cors });
    }

    const analysis = JSON.parse(jsonMatch[0]);
    return new Response(JSON.stringify({ ok: true, analysis }), { status: 200, headers: cors });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}
