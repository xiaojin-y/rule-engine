// ============= Node.js后端API示例 =============

// 1. 主应用入口 app.js
const express = require('express')
const cors = require('cors')
const http = require('http')
const socketIo = require('socket.io')
const path = require('path')
const compression = require('compression')
const helmet = require('helmet')

// 路由模块
const flowsRouter = require('./routes/flows')
const nodesRouter = require('./routes/nodes')
const runtimeRouter = require('./routes/runtime')
const authRouter = require('./routes/auth')

// 中间件
const authMiddleware = require('./middleware/auth')
const errorHandler = require('./middleware/errorHandler')
const requestLogger = require('./middleware/requestLogger')

// 核心服务
const FlowManager = require('./services/FlowManager')
const NodeRegistry = require('./services/NodeRegistry')
const RuntimeEngine = require('./services/RuntimeEngine')
const WebSocketManager = require('./services/WebSocketManager')

class NodeRedServer {
  constructor(config = {}) {
    this.config = {
      port: process.env.PORT || 1880,
      host: process.env.HOST || '0.0.0.0',
      ...config
    }
    
    this.app = express()
    this.server = http.createServer(this.app)
    this.io = socketIo(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"]
      }
    })
    
    // 初始化服务
    this.flowManager = new FlowManager()
    this.nodeRegistry = new NodeRegistry()
    this.runtimeEngine = new RuntimeEngine()
    this.wsManager = new WebSocketManager(this.io)
    
    this.setupMiddleware()
    this.setupRoutes()
    this.setupWebSocket()
    this.setupErrorHandling()
  }
  
  setupMiddleware() {
    // 安全中间件
    this.app.use(helmet())
    this.app.use(compression())
    this.app.use(cors())
    
    // 解析中间件
    this.app.use(express.json({ limit: '50mb' }))
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }))
    
    // 日志中间件
    this.app.use(requestLogger)
    
    // 静态文件
    this.app.use('/static', express.static(path.join(__dirname, 'public')))
  }
  
  setupRoutes() {
    // API路由
    this.app.use('/api/flows', flowsRouter)
    this.app.use('/api/nodes', nodesRouter)
    this.app.use('/api/runtime', runtimeRouter)
    this.app.use('/api/auth', authRouter)
    
    // 健康检查
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version 
      })
    })
    
    // 前端应用（生产环境）
    if (process.env.NODE_ENV === 'production') {
      this.app.use(express.static(path.join(__dirname, '../client/dist')))
      this.app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, '../client/dist/index.html'))
      })
    }
  }
  
  setupWebSocket() {
    this.wsManager.setup()
  }
  
  setupErrorHandling() {
    this.app.use(errorHandler)
  }
  
  start() {
    return new Promise((resolve) => {
      this.server.listen(this.config.port, this.config.host, () => {
        console.log(`Node-RED server listening on ${this.config.host}:${this.config.port}`)
        resolve()
      })
    })
  }
}

// 2. 流程管理路由 routes/flows.js
const express = require('express')
const Joi = require('joi')
const FlowManager = require('../services/FlowManager')
const { validateRequest } = require('../middleware/validation')

const router = express.Router()
const flowManager = new FlowManager()

// 流程数据验证模式
const flowSchema = Joi.object({
  id: Joi.string(),
  label: Joi.string().required(),
  nodes: Joi.array().items(Joi.object({
    id: Joi.string().required(),
    type: Joi.string().required(),
    x: Joi.number().required(),
    y: Joi.number().required(),
    properties: Joi.object().default({})
  })).default([]),
  connections: Joi.array().items(Joi.object({
    id: Joi.string().required(),
    source: Joi.string().required(),
    sourcePort: Joi.string().default('output'),
    target: Joi.string().required(),
    targetPort: Joi.string().default('input')
  })).default([])
})

// 获取所有流程
router.get('/', async (req, res, next) => {
  try {
    const flows = await flowManager.getAllFlows()
    res.json({
      success: true,
      data: flows
    })
  } catch (error) {
    next(error)
  }
})

// 获取特定流程
router.get('/:id', async (req, res, next) => {
  try {
    const flow = await flowManager.getFlowById(req.params.id)
    if (!flow) {
      return res.status(404).json({
        success: false,
        error: 'Flow not found'
      })
    }
    res.json({
      success: true,
      data: flow
    })
  } catch (error) {
    next(error)
  }
})

// 创建新流程
router.post('/', validateRequest(flowSchema), async (req, res, next) => {
  try {
    const flow = await flowManager.createFlow(req.body)
    res.status(201).json({
      success: true,
      data: flow
    })
  } catch (error) {
    next(error)
  }
})

// 更新流程
router.put('/:id', validateRequest(flowSchema), async (req, res, next) => {
  try {
    const flow = await flowManager.updateFlow(req.params.id, req.body)
    if (!flow) {
      return res.status(404).json({
        success: false,
        error: 'Flow not found'
      })
    }
    
    // 通知客户端流程已更新
    req.io.emit('flow:updated', { flowId: req.params.id, flow })
    
    res.json({
      success: true,
      data: flow
    })
  } catch (error) {
    next(error)
  }
})

// 删除流程
router.delete('/:id', async (req, res, next) => {
  try {
    const success = await flowManager.deleteFlow(req.params.id)
    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'Flow not found'
      })
    }
    
    // 通知客户端流程已删除
    req.io.emit('flow:deleted', { flowId: req.params.id })
    
    res.json({
      success: true,
      message: 'Flow deleted successfully'
    })
  } catch (error) {
    next(error)
  }
})

// 部署流程
router.post('/:id/deploy', async (req, res, next) => {
  try {
    const result = await flowManager.deployFlow(req.params.id)
    
    // 通知客户端部署状态
    req.io.emit('flow:deployed', { 
      flowId: req.params.id, 
      status: result.success ? 'success' : 'error',
      message: result.message 
    })
    
    res.json({
      success: true,
      data: result
    })
  } catch (error) {
    next(error)
  }
})

module.exports = router

// 3. 流程管理服务 services/FlowManager.js
const EventEmitter = require('events')
const { v4: uuidv4 } = require('uuid')
const FlowStorage = require('./FlowStorage')
const NodeValidator = require('./NodeValidator')

class FlowManager extends EventEmitter {
  constructor() {
    super()
    this.storage = new FlowStorage()
    this.validator = new NodeValidator()
    this.activeFlows = new Map()
  }
  
  async getAllFlows() {
    return await this.storage.getAllFlows()
  }
  
  async getFlowById(id) {
    return await this.storage.getFlowById(id)
  }
  
  async createFlow(flowData) {
    // 验证流程数据
    const validationResult = await this.validator.validateFlow(flowData)
    if (!validationResult.valid) {
      throw new Error(`Flow validation failed: ${validationResult.errors.join(', ')}`)
    }
    
    const flow = {
      id: flowData.id || uuidv4(),
      label: flowData.label,
      nodes: flowData.nodes || [],
      connections: flowData.connections || [],
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      status: 'stopped'
    }
    
    const savedFlow = await this.storage.saveFlow(flow)
    this.emit('flow:created', savedFlow)
    
    return savedFlow
  }
  
  async updateFlow(id, updateData) {
    const existingFlow = await this.storage.getFlowById(id)
    if (!existingFlow) {
      return null
    }
    
    // 验证更新数据
    const validationResult = await this.validator.validateFlow(updateData)
    if (!validationResult.valid) {
      throw new Error(`Flow validation failed: ${validationResult.errors.join(', ')}`)
    }
    
    const updatedFlow = {
      ...existingFlow,
      ...updateData,
      modified: new Date().toISOString()
    }
    
    const savedFlow = await this.storage.saveFlow(updatedFlow)
    this.emit('flow:updated', savedFlow)
    
    return savedFlow
  }
  
  async deleteFlow(id) {
    const flow = await this.storage.getFlowById(id)
    if (!flow) {
      return false
    }
    
    // 停止运行中的流程
    if (this.activeFlows.has(id)) {
      await this.stopFlow(id)
    }
    
    const success = await this.storage.deleteFlow(id)
    if (success) {
      this.emit('flow:deleted', { id })
    }
    
    return success
  }
  
  async deployFlow(id) {
    const flow = await this.storage.getFlowById(id)
    if (!flow) {
      throw new Error('Flow not found')
    }
    
    try {
      // 停止现有运行
      if (this.activeFlows.has(id)) {
        await this.stopFlow(id)
      }
      
      // 启动新的流程实例
      const flowInstance = await this.startFlow(flow)
      this.activeFlows.set(id, flowInstance)
      
      // 更新流程状态
      await this.storage.updateFlowStatus(id, 'running')
      
      this.emit('flow:deployed', { id, flow })
      
      return {
        success: true,
        message: 'Flow deployed successfully',
        flowId: id
      }
    } catch (error) {
      await this.storage.updateFlowStatus(id, 'error')
      throw error
    }
  }
  
  async startFlow(flow) {
    // 创建流程运行时实例
    const RuntimeEngine = require('./RuntimeEngine')
    const engine = new RuntimeEngine()
    
    // 初始化流程
    await engine.initializeFlow(flow)
    
    // 启动流程
    await engine.start()
    
    return engine
  }
  
  async stopFlow(id) {
    const flowInstance = this.activeFlows.get(id)
    if (flowInstance) {
      await flowInstance.stop()
      this.activeFlows.delete(id)
      await this.storage.updateFlowStatus(id, 'stopped')
    }
  }
}

// 4. 运行时引擎 services/RuntimeEngine.js
class RuntimeEngine extends EventEmitter {
  constructor() {
    super()
    this.nodes = new Map()
    this.messageQueue = []
    this.isRunning = false
    this.context = {}
  }
  
  async initializeFlow(flow) {
    this.flow = flow
    
    // 初始化节点实例
    for (const nodeConfig of flow.nodes) {
      const node = await this.createNodeInstance(nodeConfig)
      this.nodes.set(nodeConfig.id, node)
    }
    
    // 建立连接
    this.setupConnections(flow.connections)
  }
  
  async createNodeInstance(config) {
    const NodeRegistry = require('./NodeRegistry')
    const registry = new NodeRegistry()
    
    const NodeClass = registry.getNodeClass(config.type)
    if (!NodeClass) {
      throw new Error(`Unknown node type: ${config.type}`)
    }
    
    const node = new NodeClass(config)
    
    // 设置消息处理
    node.on('message', (msg) => {
      this.handleNodeMessage(config.id, msg)
    })
    
    return node
  }
  
  setupConnections(connections) {
    this.connections = connections
  }
  
  async start() {
    this.isRunning = true
    
    // 启动所有节点
    for (const [nodeId, node] of this.nodes) {
      if (typeof node.start === 'function') {
        await node.start()
      }
    }
    
    this.emit('runtime:started')
  }
  
  async stop() {
    this.isRunning = false
    
    // 停止所有节点
    for (const [nodeId, node] of this.nodes) {
      if (typeof node.stop === 'function') {
        await node.stop()
      }
    }
    
    this.emit('runtime:stopped')
  }
  
  handleNodeMessage(sourceNodeId, message) {
    // 查找目标节点
    const targetConnections = this.connections.filter(
      conn => conn.source === sourceNodeId
    )
    
    for (const connection of targetConnections) {
      const targetNode = this.nodes.get(connection.target)
      if (targetNode && typeof targetNode.receive === 'function') {
        // 异步发送消息给目标节点
        setImmediate(() => {
          targetNode.receive(message, connection.targetPort)
        })
      }
    }
  }
  
  injectMessage(nodeId, message) {
    const node = this.nodes.get(nodeId)
    if (node && typeof node.receive === 'function') {
      node.receive(message)
    }
  }
}

// 5. WebSocket管理服务 services/WebSocketManager.js
class WebSocketManager {
  constructor(io) {
    this.io = io
    this.connectedClients = new Map()
  }
  
  setup() {
    this.io.on('connection', (socket) => {
      console.log(`Client connected: ${socket.id}`)
      
      // 存储客户端信息
      this.connectedClients.set(socket.id, {
        socket,
        connectedAt: new Date(),
        subscriptions: new Set()
      })
      
      // 设置事件处理器
      this.setupSocketEvents(socket)
      
      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`)
        this.connectedClients.delete(socket.id)
      })
    })
  }
  
  setupSocketEvents(socket) {
    // 订阅流程状态
    socket.on('subscribe:flow', (flowId) => {
      socket.join(`flow:${flowId}`)
      const client = this.connectedClients.get(socket.id)
      if (client) {
        client.subscriptions.add(`flow:${flowId}`)
      }
    })
    
    // 取消订阅
    socket.on('unsubscribe:flow', (flowId) => {
      socket.leave(`flow:${flowId}`)
      const client = this.connectedClients.get(socket.id)
      if (client) {
        client.subscriptions.delete(`flow:${flowId}`)
      }
    })
    
    // 实时节点状态更新
    socket.on('node:status', (data) => {
      socket.to(`flow:${data.flowId}`).emit('node:status:update', data)
    })
    
    // 调试消息
    socket.on('debug:message', (data) => {
      socket.to(`flow:${data.flowId}`).emit('debug:message', data)
    })
  }
  
  // 广播流程状态更新
  broadcastFlowStatus(flowId, status) {
    this.io.to(`flow:${flowId}`).emit('flow:status', {
      flowId,
      status,
      timestamp: new Date().toISOString()
    })
  }
  
  // 广播节点消息
  broadcastNodeMessage(flowId, nodeId, message) {
    this.io.to(`flow:${flowId}`).emit('node:message', {
      flowId,
      nodeId,
      message,
      timestamp: new Date().toISOString()
    })
  }
}

// 6. 基础节点类 nodes/BaseNode.js
class BaseNode extends EventEmitter {
  constructor(config) {
    super()
    this.id = config.id
    this.type = config.type
    this.name = config.name || config.type
    this.properties = config.properties || {}
    this.status = { fill: 'grey', text: 'stopped' }
  }
  
  // 发送消息给下游节点
  send(message) {
    this.emit('message', message)
  }
  
  // 接收上游消息
  receive(message, port = 'input') {
    // 子类重写此方法
  }
  
  // 更新节点状态
  updateStatus(status) {
    this.status = { ...this.status, ...status }
    this.emit('status', this.status)
  }
  
  // 记录日志
  log(message, level = 'info') {
    this.emit('log', {
      nodeId: this.id,
      level,
      message,
      timestamp: new Date().toISOString()
    })
  }
  
  // 错误处理
  error(error) {
    this.updateStatus({ fill: 'red', text: 'error' })
    this.emit('error', {
      nodeId: this.id,
      error: error.message || error,
      timestamp: new Date().toISOString()
    })
  }
}

// 7. 示例节点实现 nodes/InjectNode.js
class InjectNode extends BaseNode {
  constructor(config) {
    super(config)
    this.interval = null
    this.payload = this.properties.payload || 'Hello World'
    this.repeat = this.properties.repeat || false
    this.repeatInterval = this.properties.repeatInterval || 1000
  }
  
  async start() {
    this.updateStatus({ fill: 'green', text: 'ready' })
    
    if (this.repeat) {
      this.interval = setInterval(() => {
        this.inject()
      }, this.repeatInterval)
    }
  }
  
  async stop() {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    this.updateStatus({ fill: 'grey', text: 'stopped' })
  }
  
  inject() {
    const message = {
      payload: this.payload,
      timestamp: Date.now(),
      _msgid: this.generateMessageId()
    }
    
    this.send(message)
    this.updateStatus({ fill: 'blue', text: 'injected' })
    
    // 状态重置
    setTimeout(() => {
      this.updateStatus({ fill: 'green', text: 'ready' })
    }, 100)
  }
  
  generateMessageId() {
    return Math.random().toString(36).substr(2, 9)
  }
}

// 8. 错误处理中间件 middleware/errorHandler.js
const errorHandler = (error, req, res, next) => {
  console.error('Error:', error)
  
  // 开发环境显示详细错误
  const isDevelopment = process.env.NODE_ENV === 'development'
  
  const errorResponse = {
    success: false,
    error: error.message || 'Internal Server Error',
    timestamp: new Date().toISOString()
  }
  
  if (isDevelopment) {
    errorResponse.stack = error.stack
  }
  
  // 根据错误类型设置状态码
  let statusCode = 500
  if (error.name === 'ValidationError') {
    statusCode = 400
  } else if (error.name === 'UnauthorizedError') {
    statusCode = 401
  } else if (error.name === 'NotFoundError') {
    statusCode = 404
  }
  
  res.status(statusCode).json(errorResponse)
}

// 9. 服务器启动脚本 server.js
const NodeRedServer = require('./app')

const config = {
  port: process.env.PORT || 1880,
  host: process.env.HOST || '0.0.0.0'
}

const server = new NodeRedServer(config)

// 优雅关闭
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...')
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...')
  process.exit(0)
})

// 启动服务器
server.start().then(() => {
  console.log('Node-RED server started successfully')
}).catch((error) => {
  console.error('Failed to start server:', error)
  process.exit(1)
})

module.exports = { NodeRedServer, BaseNode, InjectNode }

// 10. package.json
const packageJson = {
  "name": "node-red-vue-backend",
  "version": "1.0.0",
  "description": "Node-RED Vue.js Backend API",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "jest",
    "test:watch": "jest --watch"
  },
  "dependencies": {
    "express": "^4.18.2",
    "socket.io": "^4.7.2",
    "cors": "^2.8.5",
    "helmet": "^7.0.0",
    "compression": "^1.7.4",
    "joi": "^17.9.2",
    "uuid": "^9.0.0",
    "winston": "^3.10.0",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.2"
  },
  "devDependencies": {
    "nodemon": "^3.0.1",
    "jest": "^29.6.2",
    "supertest": "^6.3.3"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}