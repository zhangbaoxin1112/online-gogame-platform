const express = require('express')
const router = express.Router()

// 检查Node.js版本是否支持内置fetch
let fetch
if (global.fetch) {
  fetch = global.fetch
} else {
  // 对于较老版本，需要安装node-fetch
  try {
    fetch = require('node-fetch')
  } catch (error) {
    console.error('请安装node-fetch: npm install node-fetch')
    throw error
  }
}

// 大模型移动API
router.post('/move', async (req, res) => {
  try {
    const { board, currentPlayer, boardSize, moveHistory, validMoves } = req.body

    // 验证输入
    if (!board || !currentPlayer || !boardSize || !validMoves) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数'
      })
    }

    // 这里应该调用实际的大模型API
    // 目前使用模拟实现
    const move = await simulateLLMMove(board, currentPlayer, boardSize, moveHistory, validMoves)

    res.json({
      success: true,
      data: {
        move: move
      }
    })
  } catch (error) {
    console.error('大模型API错误:', error)
    res.status(500).json({
      success: false,
      message: '服务器内部错误'
    })
  }
})

// 调用真实大模型API（支持OpenAI兼容格式和Anthropic格式）
async function callRealLLM(board, currentPlayer, boardSize, moveHistory, validMoves) {
  try {
    // 构建围棋局面描述
    const boardDescription = buildGoPositionDescription(board, boardSize, currentPlayer, validMoves)
    const systemPrompt = "你是一个专业的围棋AI助手。你会分析棋盘局面，给出最佳的落子位置。请严格按照要求返回JSON格式，不要包含任何其他文字或解释。"

    const apiUrl = process.env.ANTHROPIC_API_URL || 'https://api.deepseek.com/v1/chat/completions'
    const model = process.env.ANTHROPIC_MODEL || 'deepseek-chat'
    const apiKey = process.env.ANTHROPIC_API_KEY

    // 判断API类型：Anthropic格式 vs OpenAI兼容格式
    const isAnthropicAPI = apiUrl.includes('anthropic.com')

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    }
    if (isAnthropicAPI) {
      headers['anthropic-version'] = '2023-06-01'
    }

    let body
    if (isAnthropicAPI) {
      // Anthropic Messages API 格式
      body = JSON.stringify({
        model: model,
        max_tokens: 1024,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: boardDescription
        }]
      })
    } else {
      // OpenAI 兼容 API 格式 (DeepSeek, OpenAI 等)
      body = JSON.stringify({
        model: model,
        max_tokens: 1024,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: boardDescription }
        ]
      })
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: headers,
      body: body
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('大模型API错误:', response.status, errorText)
      throw new Error(`API调用失败: ${response.status}`)
    }

    const data = await response.json()

    // 解析响应：兼容OpenAI格式和Anthropic格式
    let content
    if (isAnthropicAPI) {
      // Anthropic 响应格式
      if (!data.content || !data.content[0] || !data.content[0].text) {
        throw new Error('无效的Anthropic API响应格式')
      }
      content = data.content[0].text.trim()
    } else {
      // OpenAI 兼容响应格式
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('无效的OpenAI兼容API响应格式')
      }
      content = data.choices[0].message.content.trim()
    }
    console.log('大模型原始响应:', content)

    // 首先尝试直接解析JSON
    try {
      const move = JSON.parse(content)
      const result = validateAndProcessMove(move, validMoves, boardSize)
      if (result) {
        return result
      }
    } catch (jsonError) {
      console.log('直接JSON解析失败，尝试提取JSON:', jsonError.message)
    }

    // 如果直接解析失败，尝试从文本中提取JSON
    const extractedMove = extractMoveFromText(content, validMoves, boardSize)
    if (extractedMove) {
      console.log('成功从文本中提取着法:', extractedMove)
      return extractedMove
    }

    // 如果都失败，分析文本内容决定策略
    return analyzeTextAndDecideMove(content, validMoves, boardSize, currentPlayer)

  } catch (error) {
    console.error('调用大模型API失败:', error)
    throw error
  }
}

// 验证和处理着法
function validateAndProcessMove(move, validMoves, boardSize) {
  // 验证着法格式
  if (move.pass === true) {
    return { pass: true }
  } else if (typeof move.x === 'number' && typeof move.y === 'number') {
    // 验证着法是否合法
    const isValid = validMoves.some(vm => vm.x === move.x && vm.y === move.y)
    if (isValid && move.x >= 0 && move.x < boardSize && move.y >= 0 && move.y < boardSize) {
      return { x: move.x, y: move.y }
    } else {
      console.warn('大模型返回的着法不合法或超出范围:', move)
      return null
    }
  } else {
    console.warn('大模型返回的着法格式不正确:', move)
    return null
  }
}

// 从文本中提取JSON着法
function extractMoveFromText(text, validMoves, boardSize) {
  try {
    // 尝试查找JSON格式的内容
    const jsonMatch = text.match(/\{[^}]*\}/)
    if (jsonMatch) {
      const jsonStr = jsonMatch[0]
      const move = JSON.parse(jsonStr)
      return validateAndProcessMove(move, validMoves, boardSize)
    }

    // 尝试匹配坐标格式 (x: 10, y: 10) 或类似格式
    const coordMatch = text.match(/(?:x|横坐标|列)[:：]?\s*(\d+).*?(?:y|纵坐标|行)[:：]?\s*(\d+)/i)
    if (coordMatch) {
      const x = parseInt(coordMatch[1])
      const y = parseInt(coordMatch[2])
      const move = { x, y }
      return validateAndProcessMove(move, validMoves, boardSize)
    }

    // 尝试匹配 "(10, 10)" 格式
    const parenMatch = text.match(/\((\d+)\s*[,，]\s*(\d+)\)/)
    if (parenMatch) {
      const x = parseInt(parenMatch[1])
      const y = parseInt(parenMatch[2])
      const move = { x, y }
      return validateAndProcessMove(move, validMoves, boardSize)
    }

    return null
  } catch (error) {
    console.error('提取着法时出错:', error)
    return null
  }
}

// 分析文本内容并决定着法
function analyzeTextAndDecideMove(text, validMoves, boardSize, currentPlayer) {
  const lowerText = text.toLowerCase()

  // 如果文本明确表示PASS
  if (lowerText.includes('pass') || lowerText.includes('弃权') ||
      lowerText.includes('放弃') || lowerText.includes('停手')) {
    return { pass: true }
  }

  // 如果文本包含坐标信息，尝试提取
  const numbers = text.match(/\d+/g)
  if (numbers && numbers.length >= 2) {
    // 尝试多组数字组合
    for (let i = 0; i < numbers.length - 1; i++) {
      const x = parseInt(numbers[i])
      const y = parseInt(numbers[i + 1])
      if (x >= 0 && x < boardSize && y >= 0 && y < boardSize) {
        const move = { x, y }
        const result = validateAndProcessMove(move, validMoves, boardSize)
        if (result && !result.pass) {
          console.log('从数字中提取有效着法:', result)
          return result
        }
      }
    }
  }

  // 如果无法解析，但有合法着法，返回一个默认策略
  if (validMoves.length > 0) {
    console.log('无法解析大模型响应，使用启发式选择:', text)

    // 优先选择中间位置的着法
    const center = (boardSize - 1) / 2
    let bestMove = validMoves[0]
    let minDistance = Math.abs(bestMove.x - center) + Math.abs(bestMove.y - center)

    for (const move of validMoves) {
      const distance = Math.abs(move.x - center) + Math.abs(move.y - center)
      if (distance < minDistance) {
        minDistance = distance
        bestMove = move
      }
    }

    return { x: bestMove.x, y: bestMove.y }
  }

  // 最后才选择PASS
  return { pass: true }
}

// 构建围棋局面描述
function buildGoPositionDescription(board, boardSize, currentPlayer, validMoves) {
  let description = `当前是一个${boardSize}×${boardSize}的围棋局面。\n\n`
  description += `当前轮到${currentPlayer === 'black' ? '黑子' : '白子'}落子。\n\n`
  description += "棋盘状态（●=黑子，○=白子，.=空点）：\n\n"

  // 添加行列标记
  description += "   "
  for (let x = 0; x < boardSize; x++) {
    description += `${x.toString().padStart(2)} `
  }
  description += "\n"

  for (let y = 0; y < boardSize; y++) {
    description += `${y.toString().padStart(2)}  `
    for (let x = 0; x < boardSize; x++) {
      if (board[y][x] === null) {
        description += ".  "
      } else if (board[y][x] === 'black') {
        description += "●  "
      } else {
        description += "○  "
      }
    }
    description += "\n"
  }

  // 添加合法着法信息
  description += `\n合法着法数量: ${validMoves.length}\n`
  if (validMoves.length > 0) {
    description += "前10个合法着法坐标: "
    const sampleMoves = validMoves.slice(0, 10)
    description += sampleMoves.map(m => `(${m.x},${m.y})`).join(', ')
    if (validMoves.length > 10) {
      description += ` ... 等${validMoves.length}个选择`
    }
    description += "\n"
  }

  description += "\n请分析当前局面，考虑以下因素：\n"
  description += "1. 实地与外势的平衡\n"
  description += "2. 棋子的连接与切断\n"
  description += "3. 死活问题\n"
  description += "4. 征子和劫争\n"
  description += "5. 终局收束价值\n"
  description += "6. 优先选择有发展潜力的位置，避免轻易PASS\n\n"

  description += "重要提醒：\n"
  description += "- 除非局面确实无好棋可下，否则不要选择PASS\n"
  description += "- 优先选择能够发展、扩张或防守的关键位置\n"
  description += "- 考虑棋子的效率和全局平衡\n\n"

  description += "请严格按照以下JSON格式返回你的最佳着法：\n"
  description += "{\"x\": x坐标数字, \"y\": y坐标数字}\n"
  description += "只有在确实认为应该弃权时才返回：\n"
  description += "{\"pass\": true}\n\n"
  description += "请只返回JSON格式，不要包含任何其他文字、解释或标点符号！\n"
  description += "你的响应应该只有类似这样的内容：{\"x\": 10, \"y\": 10}"

  return description
}

// 模拟大模型移动（降级方案）
async function simulateLLMMove(board, currentPlayer, boardSize, moveHistory, validMoves) {
  // 如果没有合法着法，直接PASS
  if (validMoves.length === 0) {
    return { pass: true }
  }

  // 多次尝试调用真实大模型（最多3次）
  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`尝试调用大模型API (第${attempt}次)...`)
      const realMove = await callRealLLM(board, currentPlayer, boardSize, moveHistory, validMoves)

      if (realMove) {
        if (realMove.pass) {
          console.log('大模型选择PASS')
          // 即使是PASS，也检查是否真的必要
          if (validMoves.length > 50) {
            // 如果还有很多合法着法，大模型可能判断失误，使用启发式策略
            console.log('合法着法很多但大模型选择PASS，使用启发式策略')
            break
          }
        }
        console.log('大模型返回有效着法:', realMove)
        return realMove
      }
    } catch (error) {
      lastError = error
      console.warn(`大模型调用第${attempt}次失败:`, error.message)

      // 最后一次尝试失败后才退出循环
      if (attempt < 3) {
        // 等待短暂时间后重试
        await new Promise(resolve => setTimeout(resolve, 500 * attempt))
      }
    }
  }

  console.log('大模型调用失败或返回无效，使用启发式策略:', lastError?.message)

  // 改进的启发式策略
  return getHeuristicMove(board, currentPlayer, boardSize, validMoves)
}

// 改进的启发式策略
function getHeuristicMove(board, currentPlayer, boardSize, validMoves) {
  // 1. 优先寻找能够吃子的着法
  for (const move of validMoves) {
    const captures = simulateCaptures(board, move.x, move.y, currentPlayer, boardSize)
    if (captures > 0) {
      console.log('启发式策略：选择吃子着法', move)
      return { x: move.x, y: move.y }
    }
  }

  // 2. 优先寻找能够连接己方棋子的着法
  let bestConnectionMove = null
  let maxConnections = 0

  for (const move of validMoves) {
    const connections = countConnections(board, move.x, move.y, currentPlayer, boardSize)
    if (connections > maxConnections) {
      maxConnections = connections
      bestConnectionMove = move
    }
  }

  if (bestConnectionMove && maxConnections > 0) {
    console.log('启发式策略：选择连接着法', bestConnectionMove, '连接数:', maxConnections)
    return { x: bestConnectionMove.x, y: bestConnectionMove.y }
  }

  // 3. 优先选择靠近中心的着法（开局策略）
  const center = (boardSize - 1) / 2
  let bestMoves = []
  let minDistance = Infinity

  for (const move of validMoves) {
    const distance = Math.abs(move.x - center) + Math.abs(move.y - center)
    if (distance < minDistance) {
      minDistance = distance
      bestMoves = [move]
    } else if (distance === minDistance) {
      bestMoves.push(move)
    }
  }

  // 4. 从候选着法中选择一个，但避免边缘位置
  let selectedMove
  const edgeThreshold = 2
  const nonEdgeMoves = bestMoves.filter(move =>
    move.x >= edgeThreshold && move.x < boardSize - edgeThreshold &&
    move.y >= edgeThreshold && move.y < boardSize - edgeThreshold
  )

  if (nonEdgeMoves.length > 0) {
    selectedMove = nonEdgeMoves[Math.floor(Math.random() * nonEdgeMoves.length)]
  } else {
    selectedMove = bestMoves[Math.floor(Math.random() * bestMoves.length)]
  }

  console.log('启发式策略：选择中心着法', selectedMove, '距离:', minDistance)

  return {
    x: selectedMove.x,
    y: selectedMove.y
  }
}

// 模拟吃子数量（辅助函数）
function simulateCaptures(board, x, y, color, boardSize) {
  const newBoard = board.map(row => [...row])
  newBoard[y][x] = color

  const opponent = color === 'black' ? 'white' : 'black'
  const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]]
  let captures = 0

  for (const [dx, dy] of directions) {
    const nx = x + dx
    const ny = y + dy

    if (nx >= 0 && nx < boardSize && ny >= 0 && ny < boardSize && newBoard[ny][nx] === opponent) {
      const group = getGroup(newBoard, nx, ny, boardSize)
      if (group.length > 0 && !hasLiberty(newBoard, group, boardSize)) {
        captures += group.length
      }
    }
  }

  return captures
}

// 统计连接数（辅助函数）
function countConnections(board, x, y, color, boardSize) {
  const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]]
  let count = 0

  for (const [dx, dy] of directions) {
    const nx = x + dx
    const ny = y + dy

    if (nx >= 0 && nx < boardSize && ny >= 0 && ny < boardSize && board[ny][nx] === color) {
      count++
    }
  }

  return count
}

// 获取棋子群（辅助函数）
function getGroup(board, x, y, boardSize) {
  if (x < 0 || x >= boardSize || y < 0 || y >= boardSize) return []

  const color = board[y][x]
  if (color === null) return []

  const group = []
  const visited = new Set()
  const stack = [{ x, y }]

  while (stack.length > 0) {
    const pos = stack.pop()
    const key = `${pos.x},${pos.y}`

    if (visited.has(key)) continue
    if (pos.x < 0 || pos.x >= boardSize || pos.y < 0 || pos.y >= boardSize) continue
    if (board[pos.y][pos.x] !== color) continue

    visited.add(key)
    group.push(pos)

    stack.push({ x: pos.x + 1, y: pos.y })
    stack.push({ x: pos.x - 1, y: pos.y })
    stack.push({ x: pos.x, y: pos.y + 1 })
    stack.push({ x: pos.x, y: pos.y - 1 })
  }

  return group
}

// 检查棋子群是否有气（辅助函数）
function hasLiberty(board, group, boardSize) {
  const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]]

  for (const pos of group) {
    for (const [dx, dy] of directions) {
      const nx = pos.x + dx
      const ny = pos.y + dy

      if (nx >= 0 && nx < boardSize && ny >= 0 && ny < boardSize && board[ny][nx] === null) {
        return true
      }
    }
  }

  return false
}

module.exports = router