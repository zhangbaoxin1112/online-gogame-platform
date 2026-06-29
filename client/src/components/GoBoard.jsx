import { useRef, useEffect, useState, useCallback } from 'react'

/**
 * 围棋棋盘组件
 * 使用Canvas渲染，支持PC和移动端
 */
const GoBoard = ({ 
  size = 19, 
  board, 
  onPlaceStone, 
  disabled = false,
  currentTurn,
  playerColor,
  lastMove,
  showCoordinates = true
}) => {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const [canvasSize, setCanvasSize] = useState(600)
  const [hoverPos, setHoverPos] = useState(null)

  // 计算单元格大小
  const padding = 30
  const cellSize = (canvasSize - padding * 2) / (size - 1)

  // 星位坐标
  const getStarPoints = (boardSize) => {
    if (boardSize === 19) {
      return [
        [3, 3], [3, 9], [3, 15],
        [9, 3], [9, 9], [9, 15],
        [15, 3], [15, 9], [15, 15]
      ]
    } else if (boardSize === 13) {
      return [
        [3, 3], [3, 9], [6, 6], [9, 3], [9, 9]
      ]
    } else if (boardSize === 9) {
      return [[2, 2], [2, 6], [4, 4], [6, 2], [6, 6]]
    }
    return []
  }

  // 响应式调整大小
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.clientWidth
        const containerHeight = window.innerHeight - 200
        const maxSize = Math.min(containerWidth, containerHeight, 700)
        setCanvasSize(Math.max(300, maxSize))
      }
    }

    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [])

  // 绘制棋盘
  const drawBoard = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1

    // 设置高清画布
    canvas.width = canvasSize * dpr
    canvas.height = canvasSize * dpr
    canvas.style.width = `${canvasSize}px`
    canvas.style.height = `${canvasSize}px`
    ctx.scale(dpr, dpr)

    // 绘制背景
    const gradient = ctx.createLinearGradient(0, 0, canvasSize, canvasSize)
    gradient.addColorStop(0, '#DEB887')
    gradient.addColorStop(1, '#C4A06B')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, canvasSize, canvasSize)

    // 绘制木纹效果
    ctx.strokeStyle = 'rgba(139, 90, 43, 0.1)'
    ctx.lineWidth = 1
    for (let i = 0; i < canvasSize; i += 20) {
      ctx.beginPath()
      ctx.moveTo(0, i + Math.sin(i * 0.1) * 5)
      ctx.lineTo(canvasSize, i + Math.sin(i * 0.1 + 3) * 5)
      ctx.stroke()
    }

    // 绘制网格线
    ctx.strokeStyle = '#5D4037'
    ctx.lineWidth = 1

    for (let i = 0; i < size; i++) {
      const pos = padding + i * cellSize
      
      // 横线
      ctx.beginPath()
      ctx.moveTo(padding, pos)
      ctx.lineTo(canvasSize - padding, pos)
      ctx.stroke()
      
      // 竖线
      ctx.beginPath()
      ctx.moveTo(pos, padding)
      ctx.lineTo(pos, canvasSize - padding)
      ctx.stroke()
    }

    // 绘制星位
    const starPoints = getStarPoints(size)
    ctx.fillStyle = '#5D4037'
    for (const [x, y] of starPoints) {
      const px = padding + x * cellSize
      const py = padding + y * cellSize
      ctx.beginPath()
      ctx.arc(px, py, cellSize * 0.15, 0, Math.PI * 2)
      ctx.fill()
    }

    // 绘制坐标
    if (showCoordinates) {
      ctx.fillStyle = '#5D4037'
      ctx.font = `${Math.max(10, cellSize * 0.4)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      const letters = 'ABCDEFGHJKLMNOPQRST' // 跳过I
      for (let i = 0; i < size; i++) {
        // 顶部字母
        ctx.fillText(letters[i], padding + i * cellSize, padding / 2)
        // 底部字母
        ctx.fillText(letters[i], padding + i * cellSize, canvasSize - padding / 2)
        // 左侧数字
        ctx.fillText(String(size - i), padding / 2, padding + i * cellSize)
        // 右侧数字
        ctx.fillText(String(size - i), canvasSize - padding / 2, padding + i * cellSize)
      }
    }

    // 绘制棋子
    if (board) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const stone = board[y][x]
          if (stone) {
            drawStone(ctx, x, y, stone)
          }
        }
      }
    }

    // 绘制最后一手标记
    if (lastMove && !lastMove.pass) {
      const { x, y } = lastMove
      const px = padding + x * cellSize
      const py = padding + y * cellSize
      
      ctx.strokeStyle = lastMove.color === 'black' ? '#fff' : '#000'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(px, py, cellSize * 0.15, 0, Math.PI * 2)
      ctx.stroke()
    }

    // 绘制悬停预览
    if (hoverPos && !disabled && board && board[hoverPos.y][hoverPos.x] === null) {
      const isMyTurn = currentTurn === playerColor
      if (isMyTurn || !playerColor) {
        drawStone(ctx, hoverPos.x, hoverPos.y, currentTurn, 0.5)
      }
    }
  }, [board, size, canvasSize, cellSize, hoverPos, disabled, currentTurn, playerColor, lastMove, showCoordinates])

  // 绘制单个棋子
  const drawStone = (ctx, x, y, color, alpha = 1) => {
    const px = padding + x * cellSize
    const py = padding + y * cellSize
    const radius = cellSize * 0.45

    ctx.save()
    ctx.globalAlpha = alpha

    // 绘制阴影
    ctx.beginPath()
    ctx.arc(px + 2, py + 2, radius, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
    ctx.fill()

    // 绘制棋子
    const gradient = ctx.createRadialGradient(
      px - radius * 0.3, py - radius * 0.3, 0,
      px, py, radius
    )

    if (color === 'black') {
      gradient.addColorStop(0, '#4a4a4a')
      gradient.addColorStop(1, '#1a1a1a')
    } else {
      gradient.addColorStop(0, '#ffffff')
      gradient.addColorStop(1, '#d0d0d0')
    }

    ctx.beginPath()
    ctx.arc(px, py, radius, 0, Math.PI * 2)
    ctx.fillStyle = gradient
    ctx.fill()

    // 绘制边框
    ctx.strokeStyle = color === 'black' ? '#000' : '#aaa'
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.restore()
  }

  // 重绘
  useEffect(() => {
    drawBoard()
  }, [drawBoard])

  // 获取点击位置对应的棋盘坐标
  const getPositionFromEvent = (e) => {
    const canvas = canvasRef.current
    if (!canvas) return null

    const rect = canvas.getBoundingClientRect()
    let clientX, clientY

    if (e.touches) {
      clientX = e.touches[0].clientX
      clientY = e.touches[0].clientY
    } else {
      clientX = e.clientX
      clientY = e.clientY
    }

    const x = clientX - rect.left
    const y = clientY - rect.top

    const boardX = Math.round((x - padding) / cellSize)
    const boardY = Math.round((y - padding) / cellSize)

    if (boardX >= 0 && boardX < size && boardY >= 0 && boardY < size) {
      return { x: boardX, y: boardY }
    }
    return null
  }

  // 点击事件
  const handleClick = (e) => {
    if (disabled) return

    const pos = getPositionFromEvent(e)
    if (pos && onPlaceStone) {
      onPlaceStone(pos.x, pos.y)
    }
  }

  // 鼠标移动
  const handleMouseMove = (e) => {
    if (disabled) return
    const pos = getPositionFromEvent(e)
    setHoverPos(pos)
  }

  // 鼠标离开
  const handleMouseLeave = () => {
    setHoverPos(null)
  }

  // 触摸事件
  const handleTouchStart = (e) => {
    // 只有在非禁用状态下才阻止默认行为（允许回放页面滚动）
    if (!disabled) {
      e.preventDefault()
      handleClick(e)
    }
  }

  return (
    <div 
      ref={containerRef} 
      className="flex items-center justify-center w-full"
    >
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        className="go-board cursor-pointer rounded-lg"
        style={{ touchAction: disabled ? 'auto' : 'none' }}
      />
    </div>
  )
}

export default GoBoard
