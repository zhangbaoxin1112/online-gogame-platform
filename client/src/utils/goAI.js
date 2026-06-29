/**
 * 围棋AI模块
 * 实现三个难度等级的AI：
 * - 初级：随机落子 + 基本规则
 * - 中级：基于规则的启发式算法
 * - 大模型：与大模型对战（通过API调用）
 */

class GoAI {
  /**
   * 获取AI的下一步棋
   * @param {Array} board - 当前棋盘状态
   * @param {string} color - AI的颜色 ('black' or 'white')
   * @param {string} level - AI难度 ('easy', 'medium', 'hard')
   * @param {number} size - 棋盘大小
   * @returns {Object} - { x, y } 或 { pass: true }
   */
  static getMove(board, color, level, size) {
    try {
      // 验证输入
      if (!board || !Array.isArray(board) || board.length === 0) {
        console.error('无效的棋盘状态')
        return { pass: true }
      }

      switch (level) {
        case 'easy':
          return this.getEasyMove(board, color, size)
        case 'medium':
          return this.getMediumMove(board, color, size)
        case 'hard':
          // 对于大模型，返回一个特殊的标记，表示需要异步调用
          return { async: true, method: 'getHardMove', board, color, size }
        default:
          return this.getEasyMove(board, color, size)
      }
    } catch (error) {
      console.error('AI getMove 错误:', error)
      return { pass: true }
    }
  }

  /**
   * 异步获取AI的下一步棋（用于大模型）
   */
  static async getMoveAsync(board, color, level, size) {
    try {
      // 验证输入
      if (!board || !Array.isArray(board) || board.length === 0) {
        console.error('无效的棋盘状态')
        return { pass: true }
      }

      switch (level) {
        case 'easy':
          return this.getEasyMove(board, color, size)
        case 'medium':
          return this.getMediumMove(board, color, size)
        case 'hard':
          return await this.getHardMove(board, color, size)
        default:
          return this.getEasyMove(board, color, size)
      }
    } catch (error) {
      console.error('AI getMoveAsync 错误:', error)
      return { pass: true }
    }
  }

  /**
   * 初级AI - 随机落子
   */
  static getEasyMove(board, color, size) {
    const validMoves = this.getValidMoves(board, color, size)
    
    if (validMoves.length === 0) {
      return { pass: true }
    }

    // 过滤掉眼位（简单规则）
    const goodMoves = validMoves.filter(move => !this.isEye(board, move.x, move.y, color, size))
    
    if (goodMoves.length === 0) {
      return { pass: true }
    }

    // 随机选择
    return goodMoves[Math.floor(Math.random() * goodMoves.length)]
  }

  /**
   * 中级AI - 启发式算法
   */
  static getMediumMove(board, color, size) {
    const validMoves = this.getValidMoves(board, color, size)
    
    if (validMoves.length === 0) {
      return { pass: true }
    }

    const opponent = color === 'black' ? 'white' : 'black'
    let bestMove = null
    let bestScore = -Infinity

    for (const move of validMoves) {
      let score = 0
      
      // 1. 吃子得分
      const captures = this.simulateCaptures(board, move.x, move.y, color, size)
      score += captures * 10
      
      // 2. 阻止被吃
      const wouldBeCaptured = this.wouldBeCaptured(board, move.x, move.y, color, size)
      if (wouldBeCaptured) {
        score -= 5
      }
      
      // 3. 连接己方棋子
      const connections = this.countConnections(board, move.x, move.y, color, size)
      score += connections * 2
      
      // 4. 靠近棋盘中心（开局）
      const centerBonus = this.getCenterBonus(move.x, move.y, size)
      score += centerBonus
      
      // 5. 避免填眼
      if (this.isEye(board, move.x, move.y, color, size)) {
        score -= 20
      }
      
      // 6. 延伸己方势力
      score += this.getInfluenceScore(board, move.x, move.y, color, size)
      
      // 添加一点随机性
      score += Math.random() * 2

      if (score > bestScore) {
        bestScore = score
        bestMove = move
      }
    }

    return bestMove || { pass: true }
  }

  /**
   * 大模型AI - 与大模型对战
   */
  static async getHardMove(board, color, size) {
    try {
      const validMoves = this.getValidMoves(board, color, size)

      if (validMoves.length === 0) {
        return { pass: true }
      }

      // 调用大模型API获取最佳着法
      const move = await this.getLLMMove(board, color, size, validMoves)

      if (move) {
        return move
      } else {
        console.warn('大模型返回空着法，降级到中级AI')
        return this.getMediumMove(board, color, size)
      }
    } catch (error) {
      console.error('大模型AI错误:', error)
      // 降级到中级AI
      return this.getMediumMove(board, color, size)
    }
  }

  /**
   * 调用大模型API获取着法
   */
  static async getLLMMove(board, color, size, validMoves) {
    try {
      console.log(`调用大模型API，当前玩家: ${color}, 合法着法数量: ${validMoves.length}`)

      // 构建棋盘状态描述
      const boardDescription = this.buildBoardDescription(board, size)

      // 构建历史着法
      const moveHistory = this.getMoveHistory(board, size)

      // 调用大模型API
      const response = await fetch('/api/llm/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          board: boardDescription,
          currentPlayer: color,
          boardSize: size,
          moveHistory: moveHistory,
          validMoves: validMoves.map(m => ({ x: m.x, y: m.y }))
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`大模型API HTTP错误: ${response.status}`, errorText)
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`)
      }

      const data = await response.json()
      console.log('大模型API响应:', data)

      if (data.success && data.data && data.data.move) {
        const move = data.data.move
        console.log('大模型返回着法:', move)

        // 验证返回的着法是否合法
        if (move.pass === true) {
          console.log('大模型选择PASS')
          return { pass: true }
        } else if (typeof move.x === 'number' && typeof move.y === 'number') {
          // 检查着法是否在合法着法列表中
          const isValid = validMoves.some(vm => vm.x === move.x && vm.y === move.y)
          if (isValid) {
            console.log('大模型返回有效着法:', move)
            return { x: move.x, y: move.y }
          } else {
            console.warn('大模型返回的着法不合法，尝试修正:', move)

            // 尝试修正：找到最近的合法着法
            const correctedMove = this.findNearestValidMove(move, validMoves, size)
            if (correctedMove) {
              console.log('修正后的着法:', correctedMove)
              return correctedMove
            }

            return null
          }
        } else {
          console.warn('大模型返回的着法格式不正确:', move)
          return null
        }
      } else {
        console.warn('大模型返回数据格式错误或失败:', data)
        return null
      }
    } catch (error) {
      console.error('调用大模型API失败:', error)
      throw error
    }
  }

  /**
   * 找到最近的合法着法（用于修正大模型的无效着法）
   */
  static findNearestValidMove(invalidMove, validMoves, boardSize) {
    if (validMoves.length === 0) return null

    let bestMove = null
    let minDistance = Infinity

    for (const validMove of validMoves) {
      const distance = Math.sqrt(
        Math.pow(validMove.x - invalidMove.x, 2) +
        Math.pow(validMove.y - invalidMove.y, 2)
      )

      if (distance < minDistance) {
        minDistance = distance
        bestMove = validMove
      }
    }

    // 如果距离太远，可能是大模型理解错误，不进行修正
    if (minDistance > 3) {
      console.warn(`修正距离过大 (${minDistance.toFixed(2)})，不进行修正`)
      return null
    }

    return { x: bestMove.x, y: bestMove.y }
  }

  /**
   * 构建棋盘状态描述
   */
  static buildBoardDescription(board, size) {
    const description = []
    for (let y = 0; y < size; y++) {
      const row = []
      for (let x = 0; x < size; x++) {
        if (board[y][x] === null) {
          row.push('.')
        } else if (board[y][x] === 'black') {
          row.push('●')
        } else {
          row.push('○')
        }
      }
      description.push(row.join(' '))
    }
    return description.join('\n')
  }

  /**
   * 获取历史着法（简化版，需要从游戏状态中获取）
   */
  static getMoveHistory(board, size) {
    // 这里返回空数组，实际应该从游戏状态中获取历史着法
    // 为了简化实现，我们只返回当前棋盘状态
    return []
  }

  /**
   * 获取所有合法着法
   */
  static getValidMoves(board, color, size) {
    const moves = []
    
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (board[y][x] === null && this.isValidMove(board, x, y, color, size)) {
          moves.push({ x, y })
        }
      }
    }
    
    return moves
  }

  /**
   * 检查着法是否合法
   */
  static isValidMove(board, x, y, color, size) {
    if (board[y][x] !== null) return false

    // 模拟落子
    const newBoard = board.map(row => [...row])
    newBoard[y][x] = color

    // 检查是否能吃子
    const opponent = color === 'black' ? 'white' : 'black'
    const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]]
    let canCapture = false

    for (const [dx, dy] of directions) {
      const nx = x + dx
      const ny = y + dy
      if (nx >= 0 && nx < size && ny >= 0 && ny < size && newBoard[ny][nx] === opponent) {
        const group = this.getGroup(newBoard, nx, ny, size)
        if (!this.hasLiberty(newBoard, group, size)) {
          canCapture = true
          // 模拟提子
          for (const pos of group) {
            newBoard[pos.y][pos.x] = null
          }
        }
      }
    }

    // 检查自杀
    if (!canCapture) {
      const myGroup = this.getGroup(newBoard, x, y, size)
      if (!this.hasLiberty(newBoard, myGroup, size)) {
        return false
      }
    }

    return true
  }

  /**
   * 获取棋子群
   */
  static getGroup(board, x, y, size) {
    // 边界检查
    if (x < 0 || x >= size || y < 0 || y >= size) return []
    
    const color = board[y][x]
    if (color === null) return []
    
    const group = []
    const visited = new Set()
    const stack = [{ x, y }]

    while (stack.length > 0) {
      const pos = stack.pop()
      const key = `${pos.x},${pos.y}`
      
      if (visited.has(key)) continue
      if (pos.x < 0 || pos.x >= size || pos.y < 0 || pos.y >= size) continue
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

  /**
   * 检查棋子群是否有气
   */
  static hasLiberty(board, group, size) {
    const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]]

    for (const pos of group) {
      for (const [dx, dy] of directions) {
        const nx = pos.x + dx
        const ny = pos.y + dy
        
        if (nx >= 0 && nx < size && ny >= 0 && ny < size && board[ny][nx] === null) {
          return true
        }
      }
    }

    return false
  }

  /**
   * 检查是否为眼
   */
  static isEye(board, x, y, color, size) {
    if (board[y][x] !== null) return false

    const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]]
    let friendlyCount = 0
    let edgeCount = 0

    for (const [dx, dy] of directions) {
      const nx = x + dx
      const ny = y + dy
      
      if (nx < 0 || nx >= size || ny < 0 || ny >= size) {
        edgeCount++
      } else if (board[ny][nx] === color) {
        friendlyCount++
      } else {
        return false
      }
    }

    return friendlyCount + edgeCount === 4
  }

  /**
   * 模拟吃子数量
   */
  static simulateCaptures(board, x, y, color, size) {
    const newBoard = board.map(row => [...row])
    newBoard[y][x] = color
    
    const opponent = color === 'black' ? 'white' : 'black'
    const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]]
    let captures = 0

    for (const [dx, dy] of directions) {
      const nx = x + dx
      const ny = y + dy
      
      if (nx >= 0 && nx < size && ny >= 0 && ny < size && newBoard[ny][nx] === opponent) {
        const group = this.getGroup(newBoard, nx, ny, size)
        if (!this.hasLiberty(newBoard, group, size)) {
          captures += group.length
        }
      }
    }

    return captures
  }

  /**
   * 检查落子后是否会被吃
   */
  static wouldBeCaptured(board, x, y, color, size) {
    const newBoard = board.map(row => [...row])
    newBoard[y][x] = color
    
    // 先处理吃子
    const opponent = color === 'black' ? 'white' : 'black'
    const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]]
    
    for (const [dx, dy] of directions) {
      const nx = x + dx
      const ny = y + dy
      
      if (nx >= 0 && nx < size && ny >= 0 && ny < size && newBoard[ny][nx] === opponent) {
        const group = this.getGroup(newBoard, nx, ny, size)
        if (!this.hasLiberty(newBoard, group, size)) {
          for (const pos of group) {
            newBoard[pos.y][pos.x] = null
          }
        }
      }
    }

    const myGroup = this.getGroup(newBoard, x, y, size)
    return !this.hasLiberty(newBoard, myGroup, size)
  }

  /**
   * 统计连接数
   */
  static countConnections(board, x, y, color, size) {
    const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]]
    let count = 0

    for (const [dx, dy] of directions) {
      const nx = x + dx
      const ny = y + dy
      
      if (nx >= 0 && nx < size && ny >= 0 && ny < size && board[ny][nx] === color) {
        count++
      }
    }

    return count
  }

  /**
   * 获取中心加成分数
   */
  static getCenterBonus(x, y, size) {
    const center = (size - 1) / 2
    const distance = Math.abs(x - center) + Math.abs(y - center)
    return Math.max(0, size - distance) / size * 3
  }

  /**
   * 获取势力影响分数
   */
  static getInfluenceScore(board, x, y, color, size) {
    let score = 0
    const radius = 3

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx
        const ny = y + dy
        
        if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
          if (board[ny][nx] === color) {
            score += 1 / (Math.abs(dx) + Math.abs(dy) + 1)
          }
        }
      }
    }

    return score
  }

  /**
   * 获取候选着法（用于启发式算法）
   */
  static getCandidateMoves(board, color, size, validMoves) {
    // 使用启发式方法筛选前N个最好的着法
    const scored = validMoves.map(move => {
      let score = 0
      
      // 吃子
      score += this.simulateCaptures(board, move.x, move.y, color, size) * 10
      
      // 连接
      score += this.countConnections(board, move.x, move.y, color, size) * 3
      
      // 中心
      score += this.getCenterBonus(move.x, move.y, size)
      
      // 势力
      score += this.getInfluenceScore(board, move.x, move.y, color, size)
      
      // 避免眼位
      if (this.isEye(board, move.x, move.y, color, size)) {
        score -= 100
      }

      return { ...move, score }
    })

    // 排序并取前20个
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 20)
  }

  /**
   * 随机模拟（用于启发式算法）
   */
  static simulate(board, move, color, size) {
    try {
      const newBoard = board.map(row => [...row])
      newBoard[move.y][move.x] = color

      // 随机下完这盘棋
      let currentColor = color === 'black' ? 'white' : 'black'
      let passCount = 0
      let moveCount = 0
      const maxMoves = Math.min(size * size, 150) // 限制最大步数

      while (passCount < 2 && moveCount < maxMoves) {
        const moves = this.getValidMoves(newBoard, currentColor, size)
          .filter(m => !this.isEye(newBoard, m.x, m.y, currentColor, size))

        if (moves.length === 0) {
          passCount++
        } else {
          passCount = 0
          const randomMove = moves[Math.floor(Math.random() * moves.length)]
          newBoard[randomMove.y][randomMove.x] = currentColor
          
          // 处理提子
          const opponent = currentColor === 'black' ? 'white' : 'black'
          const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]]
          
          for (const [dx, dy] of directions) {
            const nx = randomMove.x + dx
            const ny = randomMove.y + dy
            
            if (nx >= 0 && nx < size && ny >= 0 && ny < size && newBoard[ny][nx] === opponent) {
              const group = this.getGroup(newBoard, nx, ny, size)
              if (group.length > 0 && !this.hasLiberty(newBoard, group, size)) {
                for (const pos of group) {
                  newBoard[pos.y][pos.x] = null
                }
              }
            }
          }
        }

        currentColor = currentColor === 'black' ? 'white' : 'black'
        moveCount++
      }

      // 简单数子判断胜负
      let blackCount = 0
      let whiteCount = 0

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (newBoard[y][x] === 'black') blackCount++
          else if (newBoard[y][x] === 'white') whiteCount++
        }
      }

      // 贴目
      whiteCount += 7.5

      return (color === 'black' && blackCount > whiteCount) || 
             (color === 'white' && whiteCount > blackCount)
    } catch (error) {
      console.error('随机模拟出错:', error)
      return Math.random() > 0.5 // 出错时随机返回
    }
  }
}

export default GoAI
