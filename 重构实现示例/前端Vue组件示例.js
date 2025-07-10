// ============= Vue2前端组件示例 =============

// 1. 主应用组件 App.vue
const AppComponent = {
  template: `
    <div id="app">
      <el-container>
        <el-header class="app-header">
          <flow-toolbar />
        </el-header>
        <el-container>
          <el-aside width="250px" class="node-palette-container">
            <node-palette />
          </el-aside>
          <el-main class="flow-editor-main">
            <flow-canvas />
          </el-main>
          <el-aside width="300px" class="property-panel-container">
            <property-panel />
          </el-aside>
        </el-container>
      </el-container>
    </div>
  `,
  components: {
    FlowToolbar,
    NodePalette,
    FlowCanvas,
    PropertyPanel
  }
}

// 2. 流程画布组件 FlowCanvas.vue
const FlowCanvas = {
  template: `
    <div class="flow-canvas" 
         ref="canvas"
         @drop="handleDrop"
         @dragover="handleDragOver">
      <!-- SVG画布用于连接线 -->
      <svg class="connections-layer">
        <flow-connection
          v-for="connection in connections"
          :key="connection.id"
          :connection="connection"
          @delete="deleteConnection"
        />
      </svg>
      
      <!-- 节点层 -->
      <flow-node
        v-for="node in visibleNodes"
        :key="node.id"
        :node="node"
        :selected="selectedNodes.includes(node.id)"
        @select="selectNode"
        @move="moveNode"
        @connect="startConnection"
      />
      
      <!-- 选择框 -->
      <selection-box 
        v-if="selectionBox.visible"
        :box="selectionBox"
      />
    </div>
  `,
  data() {
    return {
      viewTransform: { x: 0, y: 0, scale: 1 },
      selectionBox: { visible: false, x: 0, y: 0, width: 0, height: 0 },
      dragConnection: null
    }
  },
  computed: {
    ...mapState('flows', ['nodes', 'connections', 'selectedNodes']),
    visibleNodes() {
      // 计算可见节点（视口裁剪优化）
      return this.nodes.filter(node => this.isNodeVisible(node))
    }
  },
  methods: {
    ...mapActions('flows', ['addNode', 'updateNode', 'addConnection']),
    
    handleDrop(event) {
      event.preventDefault()
      const nodeType = event.dataTransfer.getData('node-type')
      if (nodeType) {
        const rect = this.$refs.canvas.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top
        
        this.addNode({
          id: this.generateNodeId(),
          type: nodeType,
          x: x,
          y: y,
          properties: this.getDefaultProperties(nodeType)
        })
      }
    },
    
    selectNode(nodeId, event) {
      if (event.ctrlKey) {
        // 多选
        this.$store.commit('flows/TOGGLE_NODE_SELECTION', nodeId)
      } else {
        // 单选
        this.$store.commit('flows/SET_SELECTED_NODES', [nodeId])
      }
    },
    
    moveNode(nodeId, deltaX, deltaY) {
      this.updateNode({
        id: nodeId,
        updates: {
          x: this.nodes.find(n => n.id === nodeId).x + deltaX,
          y: this.nodes.find(n => n.id === nodeId).y + deltaY
        }
      })
    },
    
    startConnection(fromPort) {
      this.dragConnection = {
        from: fromPort,
        mouseX: 0,
        mouseY: 0
      }
      document.addEventListener('mousemove', this.updateConnectionDrag)
      document.addEventListener('mouseup', this.endConnectionDrag)
    }
  }
}

// 3. 流程节点组件 FlowNode.vue
const FlowNode = {
  template: `
    <div class="flow-node"
         :class="nodeClasses"
         :style="nodeStyle"
         @mousedown="startDrag"
         @click="handleClick">
      <!-- 节点图标 -->
      <div class="node-icon">
        <i :class="nodeIcon"></i>
      </div>
      
      <!-- 节点标签 -->
      <div class="node-label">
        {{ node.name || node.type }}
      </div>
      
      <!-- 输入端口 -->
      <div class="input-ports">
        <node-port
          v-for="port in inputPorts"
          :key="port.id"
          :port="port"
          type="input"
          @connection-start="$emit('connect', $event)"
        />
      </div>
      
      <!-- 输出端口 -->
      <div class="output-ports">
        <node-port
          v-for="port in outputPorts"
          :key="port.id"
          :port="port"
          type="output"
          @connection-start="$emit('connect', $event)"
        />
      </div>
      
      <!-- 节点状态指示器 -->
      <div v-if="node.status" class="node-status" :class="node.status.fill">
        <span>{{ node.status.text }}</span>
      </div>
    </div>
  `,
  props: {
    node: {
      type: Object,
      required: true
    },
    selected: {
      type: Boolean,
      default: false
    }
  },
  computed: {
    nodeClasses() {
      return {
        'flow-node': true,
        'node-selected': this.selected,
        'node-error': this.node.status?.fill === 'red',
        [`node-type-${this.node.type}`]: true
      }
    },
    nodeStyle() {
      return {
        transform: `translate(${this.node.x}px, ${this.node.y}px)`,
        width: this.node.width || '120px',
        height: this.node.height || '40px'
      }
    },
    nodeIcon() {
      return this.getNodeTypeIcon(this.node.type)
    },
    inputPorts() {
      return this.getNodePorts(this.node, 'input')
    },
    outputPorts() {
      return this.getNodePorts(this.node, 'output')
    }
  },
  methods: {
    startDrag(event) {
      if (event.button !== 0) return // 只处理左键
      
      const startX = event.clientX - this.node.x
      const startY = event.clientY - this.node.y
      
      const handleMouseMove = (e) => {
        const deltaX = e.clientX - startX - this.node.x
        const deltaY = e.clientY - startY - this.node.y
        this.$emit('move', this.node.id, deltaX, deltaY)
      }
      
      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
      
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    
    handleClick(event) {
      this.$emit('select', this.node.id, event)
    },
    
    getNodeTypeIcon(type) {
      const iconMap = {
        inject: 'el-icon-time',
        debug: 'el-icon-view',
        function: 'el-icon-cpu',
        http: 'el-icon-link',
        mqtt: 'el-icon-message'
      }
      return iconMap[type] || 'el-icon-box'
    }
  }
}

// 4. 节点调色板组件 NodePalette.vue
const NodePalette = {
  template: `
    <div class="node-palette">
      <div class="palette-search">
        <el-input
          v-model="searchQuery"
          placeholder="搜索节点..."
          prefix-icon="el-icon-search"
          size="small"
        />
      </div>
      
      <div class="palette-categories">
        <div v-for="category in filteredCategories" 
             :key="category.name"
             class="palette-category">
          <div class="category-header" @click="toggleCategory(category.name)">
            <i :class="category.expanded ? 'el-icon-arrow-down' : 'el-icon-arrow-right'"></i>
            {{ category.label }}
          </div>
          
          <div v-show="category.expanded" class="category-nodes">
            <palette-node
              v-for="nodeType in category.nodes"
              :key="nodeType.type"
              :node-type="nodeType"
              @drag-start="handleNodeDragStart"
            />
          </div>
        </div>
      </div>
    </div>
  `,
  data() {
    return {
      searchQuery: '',
      expandedCategories: ['input', 'output', 'function']
    }
  },
  computed: {
    ...mapState('nodeTypes', ['categories']),
    filteredCategories() {
      if (!this.searchQuery) {
        return this.categories.map(cat => ({
          ...cat,
          expanded: this.expandedCategories.includes(cat.name)
        }))
      }
      
      // 搜索过滤逻辑
      return this.categories
        .map(cat => ({
          ...cat,
          nodes: cat.nodes.filter(node => 
            node.name.toLowerCase().includes(this.searchQuery.toLowerCase())
          ),
          expanded: true
        }))
        .filter(cat => cat.nodes.length > 0)
    }
  },
  methods: {
    toggleCategory(categoryName) {
      const index = this.expandedCategories.indexOf(categoryName)
      if (index > -1) {
        this.expandedCategories.splice(index, 1)
      } else {
        this.expandedCategories.push(categoryName)
      }
    },
    
    handleNodeDragStart(nodeType) {
      // 开始拖拽节点到画布
      this.$emit('node-drag-start', nodeType)
    }
  }
}

// 5. 属性面板组件 PropertyPanel.vue
const PropertyPanel = {
  template: `
    <div class="property-panel">
      <div v-if="selectedNode" class="node-properties">
        <div class="panel-header">
          <h3>{{ selectedNode.name || selectedNode.type }}</h3>
          <el-button 
            type="text" 
            icon="el-icon-setting"
            @click="openNodeEditor"
          />
        </div>
        
        <el-form 
          :model="nodeProperties"
          label-position="top"
          size="small"
        >
          <el-form-item 
            v-for="prop in nodePropertyDefinitions"
            :key="prop.name"
            :label="prop.label"
          >
            <component
              :is="getPropertyComponent(prop.type)"
              v-model="nodeProperties[prop.name]"
              v-bind="prop.attrs"
              @change="updateNodeProperty(prop.name, $event)"
            />
          </el-form-item>
        </el-form>
      </div>
      
      <div v-else-if="selectedConnection" class="connection-properties">
        <!-- 连接属性编辑 -->
      </div>
      
      <div v-else class="no-selection">
        <p>选择一个节点或连接来编辑属性</p>
      </div>
    </div>
  `,
  computed: {
    ...mapState('flows', ['selectedNodes', 'selectedConnections']),
    selectedNode() {
      if (this.selectedNodes.length === 1) {
        return this.$store.getters['flows/getNodeById'](this.selectedNodes[0])
      }
      return null
    },
    nodeProperties() {
      return this.selectedNode ? { ...this.selectedNode.properties } : {}
    },
    nodePropertyDefinitions() {
      if (!this.selectedNode) return []
      return this.$store.getters['nodeTypes/getNodePropertyDefinitions'](this.selectedNode.type)
    }
  },
  methods: {
    ...mapActions('flows', ['updateNode']),
    
    updateNodeProperty(propName, value) {
      if (this.selectedNode) {
        this.updateNode({
          id: this.selectedNode.id,
          updates: {
            properties: {
              ...this.selectedNode.properties,
              [propName]: value
            }
          }
        })
      }
    },
    
    getPropertyComponent(type) {
      const componentMap = {
        string: 'el-input',
        number: 'el-input-number',
        boolean: 'el-switch',
        select: 'el-select',
        textarea: 'el-input'
      }
      return componentMap[type] || 'el-input'
    },
    
    openNodeEditor() {
      // 打开节点编辑对话框
      this.$store.dispatch('ui/openNodeEditor', this.selectedNode)
    }
  }
}

// 6. Vuex状态管理示例
const flowsModule = {
  namespaced: true,
  
  state: {
    currentFlow: null,
    nodes: [],
    connections: [],
    selectedNodes: [],
    selectedConnections: [],
    clipboard: null,
    dirty: false
  },
  
  mutations: {
    SET_CURRENT_FLOW(state, flow) {
      state.currentFlow = flow
      state.nodes = flow.nodes || []
      state.connections = flow.connections || []
    },
    
    ADD_NODE(state, node) {
      state.nodes.push({
        id: node.id || generateId(),
        ...node,
        x: node.x || 0,
        y: node.y || 0,
        properties: node.properties || {}
      })
      state.dirty = true
    },
    
    UPDATE_NODE(state, { id, updates }) {
      const nodeIndex = state.nodes.findIndex(n => n.id === id)
      if (nodeIndex > -1) {
        Object.assign(state.nodes[nodeIndex], updates)
        state.dirty = true
      }
    },
    
    DELETE_NODE(state, nodeId) {
      state.nodes = state.nodes.filter(n => n.id !== nodeId)
      // 同时删除相关连接
      state.connections = state.connections.filter(
        c => c.source !== nodeId && c.target !== nodeId
      )
      state.dirty = true
    },
    
    ADD_CONNECTION(state, connection) {
      state.connections.push({
        id: connection.id || generateId(),
        source: connection.source,
        sourcePort: connection.sourcePort,
        target: connection.target,
        targetPort: connection.targetPort
      })
      state.dirty = true
    },
    
    SET_SELECTED_NODES(state, nodeIds) {
      state.selectedNodes = nodeIds
    },
    
    TOGGLE_NODE_SELECTION(state, nodeId) {
      const index = state.selectedNodes.indexOf(nodeId)
      if (index > -1) {
        state.selectedNodes.splice(index, 1)
      } else {
        state.selectedNodes.push(nodeId)
      }
    }
  },
  
  actions: {
    async loadFlow({ commit }, flowId) {
      try {
        const response = await api.get(`/flows/${flowId}`)
        commit('SET_CURRENT_FLOW', response.data)
      } catch (error) {
        throw new Error(`Failed to load flow: ${error.message}`)
      }
    },
    
    async saveFlow({ state, commit }) {
      try {
        const flowData = {
          nodes: state.nodes,
          connections: state.connections
        }
        await api.put(`/flows/${state.currentFlow.id}`, flowData)
        commit('SET_DIRTY', false)
      } catch (error) {
        throw new Error(`Failed to save flow: ${error.message}`)
      }
    },
    
    addNode({ commit }, nodeData) {
      commit('ADD_NODE', nodeData)
    },
    
    updateNode({ commit }, { id, updates }) {
      commit('UPDATE_NODE', { id, updates })
    }
  },
  
  getters: {
    getNodeById: (state) => (id) => {
      return state.nodes.find(node => node.id === id)
    },
    
    getConnectionsForNode: (state) => (nodeId) => {
      return state.connections.filter(
        conn => conn.source === nodeId || conn.target === nodeId
      )
    },
    
    isDirty: (state) => state.dirty
  }
}

// 7. API服务示例
const api = {
  baseURL: '/api',
  
  async get(url) {
    const response = await fetch(`${this.baseURL}${url}`)
    if (!response.ok) throw new Error(response.statusText)
    return response.json()
  },
  
  async post(url, data) {
    const response = await fetch(`${this.baseURL}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    if (!response.ok) throw new Error(response.statusText)
    return response.json()
  },
  
  async put(url, data) {
    const response = await fetch(`${this.baseURL}${url}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    if (!response.ok) throw new Error(response.statusText)
    return response.json()
  }
}

// 8. Vue应用初始化
const store = new Vuex.Store({
  modules: {
    flows: flowsModule,
    nodeTypes: nodeTypesModule,
    ui: uiModule
  }
})

const app = new Vue({
  el: '#app',
  store,
  router,
  render: h => h(AppComponent)
})

// 工具函数
function generateId() {
  return Math.random().toString(36).substr(2, 9)
}