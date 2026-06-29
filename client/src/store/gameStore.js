import { create } from 'zustand'

// 围棋游戏状态管理
export const useGameStore = create((set, get) => ({
  // 棋盘状态
  boardSize: 19,
  board: null,
  moves: [],
  currentTurn: 'black', // 'black' or 'white'
  
  // 玩家信息
  playerColor: null,
  opponent: null,
  
  // 游戏状态
  gameStatus: 'idle', // 'idle', 'playing', 'finished'
  gameResult: null,
  gameId: null,
  roomId: null,
  
  // 提子记录
  capturedByBlack: 0,
  capturedByWhite: 0,
  
  // 历史记录（用于悔棋/回放）
  history: [],
  historyIndex: -1,

  // 初始化棋盘
  initBoard: (size = 19) => {
    const board = Array(size).fill(null).map(() => Array(size).fill(null))
    set({
      boardSize: size,
      board,
      moves: [],
      currentTurn: 'black',
      gameStatus: 'playing',
      gameResult: null,
      capturedByBlack: 0,
      capturedByWhite: 0,
      history: [{ board: JSON.parse(JSON.stringify(board)), moves: [] }],
      historyIndex: 0
    })
  },

  // 落子
  placeStone: (x, y) => {
    const { board, currentTurn, boardSize, moves } = get()
    
    // 验证位置
    if (x < 0 || x >= boardSize || y < 0 || y >= boardSize) {
      return { success: false, message: '无效的位置' }
    }
    
    if (board[y][x] !== null) {
      return { success: false, message: '此位置已有棋子' }
    }

    // 创建新棋盘
    const newBoard = board.map(row => [...row])
    newBoard[y][x] = currentTurn

    // 处理提子
    const captured = get().captureStones(newBoard, x, y, currentTurn)
    
    // 检查自杀规则
    if (captured.length === 0 && !get().hasLiberty(newBoard, x, y)) {
      return { success: false, message: '不能自杀' }
    }

    // 检查打劫
    if (get().isKo(newBoard)) {
      newBoard[y][x] = null
      return { success: false, message: '打劫禁着' }
    }

    // 更新提子数
    let newCapturedByBlack = get().capturedByBlack
    let newCapturedByWhite = get().capturedByWhite
    
    if (currentTurn === 'black') {
      newCapturedByBlack += captured.length
    } else {
      newCapturedByWhite += captured.length
    }

    // 记录落子
    const move = { x, y, color: currentTurn, captured, timestamp: Date.now() }
    const newMoves = [...moves, move]
    
    // 更新历史
    const { history, historyIndex } = get()
    const newHistory = history.slice(0, historyIndex + 1)
    newHistory.push({ 
      board: JSON.parse(JSON.stringify(newBoard)), 
      moves: newMoves 
    })

    set({
      board: newBoard,
      moves: newMoves,
      currentTurn: currentTurn === 'black' ? 'white' : 'black',
      capturedByBlack: newCapturedByBlack,
      capturedByWhite: newCapturedByWhite,
      history: newHistory,
      historyIndex: newHistory.length - 1
    })

    return { success: true, captured }
  },

  // PASS
  addPassMove: (color) => {
    const { moves } = get()
    // 防止重复添加同一个PASS（比如网络抖动导致的多次广播）
    const lastMove = moves[moves.length - 1]
    if (lastMove && lastMove.pass && lastMove.color === color && Date.now() - (lastMove.timestamp || 0) < 1000) {
      return
    }

    const move = { pass: true, color, timestamp: Date.now() }
    set({
      moves: [...moves, move],
      currentTurn: color === 'black' ? 'white' : 'black'
    })
  },

  // 提子逻辑
  captureStones: (board, x, y, color) => {
    const size = board.length
    const opponentColor = color === 'black' ? 'white' : 'black'
    const captured = []
    const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]]

    for (const [dx, dy] of directions) {
      const nx = x + dx
      const ny = y + dy
      
      if (nx >= 0 && nx < size && ny >= 0 && ny < size && board[ny][nx] === opponentColor) {
        const group = get().getGroup(board, nx, ny)
        if (!get().groupHasLiberty(board, group)) {
          for (const pos of group) {
            board[pos.y][pos.x] = null
            captured.push(pos)
          }
        }
      }
    }

    return captured
  },

  // 获取棋子群
  getGroup: (board, x, y) => {
    const size = board.length
    const color = board[y][x]
    const group = []
    const visited = new Set()
    const stack = [{ x, y }]

    while (stack.length > 0) {
      const pos = stack.pop()
      const key = `${pos.x},${pos.y}`
      
      if (visited.has(key)) continue
      visited.add(key)
      
      if (pos.x < 0 || pos.x >= size || pos.y < 0 || pos.y >= size) continue
      if (board[pos.y][pos.x] !== color) continue
      
      group.push(pos)
      
      stack.push({ x: pos.x + 1, y: pos.y })
      stack.push({ x: pos.x - 1, y: pos.y })
      stack.push({ x: pos.x, y: pos.y + 1 })
      stack.push({ x: pos.x, y: pos.y - 1 })
    }

    return group
  },

  // 检查棋子群是否有气
  groupHasLiberty: (board, group) => {
    const size = board.length
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
  },

  // 检查单个位置是否有气
  hasLiberty: (board, x, y) => {
    const group = get().getGroup(board, x, y)
    return get().groupHasLiberty(board, group)
  },

  // 打劫检测
  isKo: (newBoard) => {
    const { history, historyIndex } = get()
    if (historyIndex < 1) return false
    
    const prevBoard = history[historyIndex - 1]?.board
    if (!prevBoard) return false
    
    // 比较棋盘状态
    for (let y = 0; y < newBoard.length; y++) {
      for (let x = 0; x < newBoard[y].length; x++) {
        if (newBoard[y][x] !== prevBoard[y][x]) {
          return false
        }
      }
    }
    return true
  },

  // PASS
  pass: () => {
    const { moves, currentTurn } = get()
    const move = { pass: true, color: currentTurn, timestamp: Date.now() }
    const newMoves = [...moves, move]
    
    // 检查双方都PASS
    if (moves.length > 0 && moves[moves.length - 1].pass) {
      // 游戏结束，计算胜负
      const result = get().calculateResult()
      set({
        moves: newMoves,
        gameStatus: 'finished',
        gameResult: result
      })
      return { gameEnded: true, result }
    }
    
    set({
      moves: newMoves,
      currentTurn: currentTurn === 'black' ? 'white' : 'black'
    })
    
    return { gameEnded: false }
  },

  // 计算胜负（简化版数子法）
  calculateResult: () => {
    const { board, boardSize, capturedByBlack, capturedByWhite } = get()
    
    let blackTerritory = 0
    let whiteTerritory = 0
    let blackStones = 0
    let whiteStones = 0
    
    // 统计棋子数
    for (let y = 0; y < boardSize; y++) {
      for (let x = 0; x < boardSize; x++) {
        if (board[y][x] === 'black') blackStones++
        else if (board[y][x] === 'white') whiteStones++
      }
    }
    
    // 贴目（中国规则）
    const komi = 7.5
    
    const blackScore = blackStones + blackTerritory
    const whiteScore = whiteStones + whiteTerritory + komi
    
    return {
      blackScore,
      whiteScore,
      winner: blackScore > whiteScore ? 'black' : 'white',
      description: blackScore > whiteScore 
        ? `黑方胜 ${blackScore} vs ${whiteScore}`
        : `白方胜 ${whiteScore} vs ${blackScore}`
    }
  },

  // 认输
  resign: (color) => {
    const winner = color === 'black' ? 'white' : 'black'
    set({
      gameStatus: 'finished',
      gameResult: {
        winner,
        description: `${color === 'black' ? '黑方' : '白方'}认输`
      }
    })
  },

  // 设置游戏信息
  setGameInfo: (info) => {
    set(info)
  },

  // 重置游戏
  resetGame: () => {
    set({
      board: null,
      moves: [],
      currentTurn: 'black',
      playerColor: null,
      opponent: null,
      gameStatus: 'idle',
      gameResult: null,
      gameId: null,
      roomId: null,
      capturedByBlack: 0,
      capturedByWhite: 0,
      history: [],
      historyIndex: -1
    })
  },

  // 从服务器同步棋盘状态
  syncBoard: (boardData, movesData, turn) => {
    set({
      board: boardData,
      moves: movesData,
      currentTurn: turn
    })
  },

  // 接收对手落子
  receiveMove: (x, y, color, captured, moveNumber) => {
    const { board, moves } = get()
    
    // 如果 moveNumber 已对应现有步数，且位置相同，说明是重复广播，忽略
    if (moveNumber !== undefined && moves.length >= moveNumber) {
      const existingMove = moves[moveNumber - 1]
      if (existingMove && existingMove.x === x && existingMove.y === y && existingMove.color === color) {
        console.log('检测到重复落子广播，忽略:', moveNumber)
        return
      }
    }

    const newBoard = board.map(row => [...row])
    newBoard[y][x] = color
    
    // 处理提子
    for (const pos of captured) {
      newBoard[pos.y][pos.x] = null
    }
    
    const move = { x, y, color, captured, timestamp: Date.now() }
    
    let newCapturedByBlack = get().capturedByBlack
    let newCapturedByWhite = get().capturedByWhite
    
    if (color === 'black') {
      newCapturedByBlack += captured.length
    } else {
      newCapturedByWhite += captured.length
    }
    
    set({
      board: newBoard,
      moves: [...moves, move],
      currentTurn: color === 'black' ? 'white' : 'black',
      capturedByBlack: newCapturedByBlack,
      capturedByWhite: newCapturedByWhite
    })
  }
}))
