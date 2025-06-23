// File: pages/api/voice/count.ts

import type { NextApiRequest, NextApiResponse } from 'next'

// 서버 메모리 상에 카운트를 보관합니다.
// (프로덕션에서는 Redis/MySQL 등 외부 저장소를 쓰세요)
let totalCount = 0

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    const { spoke } = req.body as { spoke?: boolean }
    if (typeof spoke !== 'boolean') {
      return res.status(400).json({ error: 'Invalid payload: spoke must be boolean' })
    }
    // 무음 → 발화 전환 시 클라이언트에서 spoke=true 로 호출해 줍니다.
    if (spoke) totalCount++
    return res.status(200).json({ count: totalCount })
  }

  if (req.method === 'GET') {
    return res.status(200).json({ count: totalCount })
  }

  res.setHeader('Allow', ['GET', 'POST'])
  return res.status(405).end(`Method ${req.method} Not Allowed`)
}
