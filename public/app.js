const { createApp } = Vue;

createApp({
    data() {
        return {
            // 认证状态
            authenticated: false,
            apiKey: '',
            loading: false,
            loadingText: '',
            errorMessage: '',

            // 机器人数据
            bots: [],
            socket: null,

            // UI状态
            showAddBotModal: false,
            showConfigModal: false,
            showLogsModal: false,
            showSettingsModal: false,
            showGlobalLogs: false,
            showConnectionModal: false,
            showQrModal: false,

            // 当前操作的机器人
            currentBot: null,
            currentBotLogs: [],
            currentQrBot: null,
            logsLoaded: false, // 新增：日志是否已加载标志

            // 新增机器人表单 - 修改默认端口为8081，使用ForwardWebSocket
            newBot: {
                id: '',
                uin: '',
                protocol: 'Linux',
                port: 8081,
                accessToken: ''
            },

            // 配置相关
            configTab: 'basic',
            botConfig: {
                account: {
                    uin: 0,
                    protocol: 'Linux',
                    autoReconnect: true,
                    getOptimumServer: true
                },
                message: {
                    ignoreSelf: true,
                    stringPost: false
                },
                qrCode: {
                    consoleCompatibilityMode: false
                },
                logging: {
                    logLevel: 'Information'
                },
                signServer: {
                    url: '', // 修改：默认为空
                    proxyUrl: '',
                    musicUrl: ''
                },
                implementations: []
            },
            rawConfig: '',

            // 系统设置 - 默认重启次数改为3
            settingsTab: 'server',
            settings: {
                server: {
                    host: '0.0.0.0',
                    port: 12345,
                    apiKey: ''
                },
                bot: {
                    checkInterval: 3000,
                    qrCodeCheckInterval: 3000,
                    maxRestartAttempts: 3, // 确保默认为3
                    restartCooldown: 30000,
                    restartCountResetTime: 300000,
                    useStartCmd: false,
                    sharedExecutable: true,
                    killOnStop: true
                },
                scheduler: {
                    autoRestartAll: true,
                    autoRestartTime: '03:00',
                    checkInterval: 3000,
                    maxRestartAttempts: 3, // 确保默认为3
                    updateStartScript: true
                },
                processManagement: {
                    trackPids: true,
                    logOutput: true,
                    useKillCommand: true
                },
                botRootDir: './onebot',
                logDir: './logs',
                executablePath: './Lagrange.OneBot.exe',
                defaultSignServer: '' // 新增：默认签名服务器为空
            },

            // 连接信息
            connectionInfo: {
                host: 'localhost',
                port: 12345,
                apiKey: '',
                clientIP: '127.0.0.1',
                fullAddress: '',
                httpUrl: '',
                wsUrl: ''
            },
            connectionItems: [],
            allBotConnections: [],
            forwardPaths: [],

            // 系统信息
            systemInfo: null,

            // 全局日志 - 限制数量防止卡顿
            globalLogs: [],
            maxGlobalLogs: 100, // 新增：限制全局日志数量

            // 消息提示
            message: null,
            messageTimeout: null
        };
    },

    computed: {
        runningCount() {
            return this.bots.filter(bot => bot.status === 'running').length;
        },

        stoppedCount() {
            return this.bots.filter(bot => bot.status === 'stopped').length;
        },

        onlineCount() {
            return this.bots.filter(bot => bot.loginStatus === 'online').length;
        },

        // 计算连接地址信息
        connectionAddresses() {
            const currentHost = window.location.hostname;
            const currentPort = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
            const actualPort = this.connectionInfo.port || currentPort;
            
            return {
                webUI: `${window.location.protocol}//${currentHost}:${actualPort}`,
                wsManager: `ws://${currentHost}:${actualPort}/ws`,
                httpAPI: `${window.location.protocol}//${currentHost}:${actualPort}/api`,
                allConnections: `${currentHost}:${actualPort}/ws/all/ws`
            };
        },

        // 获取所有机器人的连接地址
        botConnectionAddresses() {
            const currentHost = window.location.hostname;
            const currentPort = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
            const actualPort = this.connectionInfo.port || currentPort;
            
            return this.bots.map(bot => {
                const implementations = this.getBotImplementations(bot);
                return {
                    botId: bot.id,
                    uin: bot.uin,
                    status: bot.status,
                    loginStatus: bot.loginStatus,
                    connections: implementations.map(impl => ({
                        type: impl.Type,
                        address: this.formatConnectionAddress(impl, currentHost, actualPort),
                        description: this.getConnectionDescription(impl)
                    }))
                };
            });
        }
    },

    async mounted() {
        await this.checkAuthStatus();
        if (this.authenticated) {
            this.initializeSocket();
            await this.loadBots();
            await this.loadSettings();
            await this.loadConnectionInfo();
            await this.loadSystemInfo();
        }
    },

    methods: {
        // 认证相关
        async checkAuthStatus() {
            try {
                const response = await fetch('/api/auth-status');
                const data = await response.json();
                this.authenticated = data.authenticated;
            } catch (error) {
                console.error('检查认证状态失败:', error);
            }
        },

        async login() {
            this.loading = true;
            this.errorMessage = '';
            
            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ key: this.apiKey })
                });

                const data = await response.json();

                if (data.success) {
                    this.authenticated = true;
                    this.initializeSocket();
                    await this.loadBots();
                    await this.loadSettings();
                    await this.loadConnectionInfo();
                    await this.loadSystemInfo();
                    this.showMessage('登录成功', 'success');
                } else {
                    this.errorMessage = data.message;
                }
            } catch (error) {
                this.errorMessage = '登录失败，请检查网络连接';
                console.error('登录失败:', error);
            } finally {
                this.loading = false;
            }
        },

        async logout() {
            try {
                await fetch('/api/logout', { method: 'POST' });
                this.authenticated = false;
                this.apiKey = '';
                if (this.socket) {
                    this.socket.disconnect();
                    this.socket = null;
                }
                this.showMessage('已退出登录', 'info');
            } catch (error) {
                console.error('退出登录失败:', error);
            }
        },

        // WebSocket连接
        initializeSocket() {
            this.socket = io();

            this.socket.on('connect', () => {
                console.log('WebSocket已连接');
            });

            this.socket.on('disconnect', () => {
                console.log('WebSocket已断开');
            });

            this.socket.on('botList', (bots) => {
                this.bots = bots;
            });

            this.socket.on('botStatusChanged', (data) => {
                const bot = this.bots.find(b => b.id === data.botId);
                if (bot) {
                    bot.status = data.status;
                    bot.loginStatus = data.loginStatus;
                    bot.isOnline = data.isOnline;
                    bot.hasQrCode = data.hasQrCode;
                    bot.statusMessage = data.message;
                    bot.lastUpdate = data.timestamp;
                    
                    // 修改：扫码登录成功后自动关闭窗口
                    if (this.currentQrBot && this.currentQrBot.id === data.botId && data.loginStatus === 'online') {
                        this.closeQrModalAndDeleteQr();
                    }
                }
            });

            this.socket.on('botLoginSuccess', (data) => {
                const bot = this.bots.find(b => b.id === data.botId);
                if (bot) {
                    bot.loginStatus = 'online';
                    bot.hasQrCode = false;
                    bot.qrCodePath = null;
                }
                this.showMessage(`机器人 ${data.botId} 登录成功`, 'success');
                
                // 修改：如果当前正在显示此机器人的二维码，自动关闭并删除
                if (this.currentQrBot && this.currentQrBot.id === data.botId) {
                    this.closeQrModalAndDeleteQr();
                }
            });

            this.socket.on('botLog', (data) => {
                // 优化：限制全局日志数量防止界面卡顿
                this.globalLogs.unshift({
                    timestamp: data.timestamp,
                    time: data.time,
                    botId: data.botId,
                    type: data.type,
                    message: data.message
                });

                // 限制全局日志数量
                if (this.globalLogs.length > this.maxGlobalLogs) {
                    this.globalLogs.splice(this.maxGlobalLogs);
                }

                // 如果当前查看的是这个机器人的日志，更新
                if (this.currentBot && this.currentBot.id === data.botId && this.logsLoaded) {
                    this.currentBotLogs.unshift({
                        timestamp: data.timestamp,
                        time: data.time,
                        type: data.type,
                        message: data.message
                    });

                    // 限制单个机器人日志数量
                    if (this.currentBotLogs.length > 200) {
                        this.currentBotLogs.splice(200);
                    }
                }
            });

            this.socket.on('botLogsHistory', (data) => {
                if (this.currentBot && this.currentBot.id === data.botId) {
                    this.currentBotLogs = data.logs || [];
                    this.logsLoaded = true;
                }
            });

            this.socket.on('qrCodeDetected', (data) => {
                const bot = this.bots.find(b => b.id === data.botId);
                if (bot) {
                    bot.hasQrCode = true;
                    bot.qrCodePath = data.qrPath;
                }
                this.showMessage(`机器人 ${data.botId}: ${data.message}`, 'info');
                
                // 自动弹出扫码界面
                this.openQrModal(bot, data.qrUrl, data.uin);
            });

            // 新增：离线状态下的二维码检测
            this.socket.on('offlineQrCodeDetected', (data) => {
                const bot = this.bots.find(b => b.id === data.botId);
                if (bot) {
                    bot.hasQrCode = true;
                    bot.qrCodePath = data.qrPath;
                }
                this.showMessage(`机器人 ${data.botId}: ${data.message}`, 'warning');
                
                // 弹出扫码界面并提示需要启动
                this.openQrModal(bot, data.qrUrl, data.uin, true);
            });
        },

        // 数据加载
        async loadBots() {
            try {
                const response = await fetch('/api/bots');
                if (response.ok) {
                    this.bots = await response.json();
                }
            } catch (error) {
                console.error('加载机器人列表失败:', error);
                this.showMessage('加载机器人列表失败', 'error');
            }
        },

        async loadSettings() {
            try {
                const response = await fetch('/api/config');
                if (response.ok) {
                    const config = await response.json();
                    // 合并加载的配置到设置中
                    if (config.server) this.settings.server = { ...this.settings.server, ...config.server };
                    if (config.bot) this.settings.bot = { ...this.settings.bot, ...config.bot };
                    if (config.scheduler) this.settings.scheduler = { ...this.settings.scheduler, ...config.scheduler };
                    if (config.processManagement) this.settings.processManagement = { ...this.settings.processManagement, ...config.processManagement };
                    if (config.botRootDir) this.settings.botRootDir = config.botRootDir;
                    if (config.logDir) this.settings.logDir = config.logDir;
                    if (config.executablePath) this.settings.executablePath = config.executablePath;
                    if (config.defaultSignServer !== undefined) this.settings.defaultSignServer = config.defaultSignServer;
                }
            } catch (error) {
                console.error('加载设置失败:', error);
            }
        },

        // 加载连接信息
        async loadConnectionInfo() {
            try {
                const response = await fetch('/api/connection-info');
                if (response.ok) {
                    this.connectionInfo = await response.json();
                }

                const copyResponse = await fetch('/api/copy-info');
                if (copyResponse.ok) {
                    const copyData = await copyResponse.json();
                    this.connectionItems = copyData.items || [];
                }
            } catch (error) {
                console.error('加载连接信息失败:', error);
            }
        },

        async loadSystemInfo() {
            try {
                const response = await fetch('/api/system-info');
                if (response.ok) {
                    this.systemInfo = await response.json();
                }
            } catch (error) {
                console.error('加载系统信息失败:', error);
            }
        },

        // 机器人操作
        async startBot(botId) {
            try {
                const response = await fetch(`/api/bots/${botId}/start`, {
                    method: 'POST'
                });
                const data = await response.json();
                
                if (data.success) {
                    this.showMessage(data.message, 'success');
                } else {
                    this.showMessage(data.message, 'error');
                }
            } catch (error) {
                console.error('启动机器人失败:', error);
                this.showMessage('启动机器人失败', 'error');
            }
        },

        async stopBot(botId) {
            try {
                const response = await fetch(`/api/bots/${botId}/stop`, {
                    method: 'POST'
                });
                const data = await response.json();
                
                if (data.success) {
                    this.showMessage(data.message, 'success');
                } else {
                    this.showMessage(data.message, 'error');
                }
            } catch (error) {
                console.error('停止机器人失败:', error);
                this.showMessage('停止机器人失败', 'error');
            }
        },

        async restartBot(botId) {
            try {
                const response = await fetch(`/api/bots/${botId}/restart`, {
                    method: 'POST'
                });
                const data = await response.json();
                
                if (data.success) {
                    this.showMessage(data.message, 'success');
                } else {
                    this.showMessage(data.message, 'error');
                }
            } catch (error) {
                console.error('重启机器人失败:', error);
                this.showMessage('重启机器人失败', 'error');
            }
        },

        async restartAllBots() {
            if (!confirm('确定要重启所有机器人吗？')) return;

            try {
                const response = await fetch('/api/bots/restart-all', {
                    method: 'POST'
                });
                const data = await response.json();
                
                if (data.success) {
                    this.showMessage(data.message, 'success');
                } else {
                    this.showMessage(data.message, 'error');
                }
            } catch (error) {
                console.error('重启所有机器人失败:', error);
                this.showMessage('重启所有机器人失败', 'error');
            }
        },

        async toggleAutoRestart(botId) {
            try {
                const response = await fetch(`/api/bots/${botId}/toggle-auto-restart`, {
                    method: 'POST'
                });
                const data = await response.json();
                
                if (data.success) {
                    const bot = this.bots.find(b => b.id === botId);
                    if (bot) {
                        bot.autoRestart = data.autoRestart;
                    }
                    this.showMessage(data.message, 'success');
                } else {
                    this.showMessage(data.message, 'error');
                }
            } catch (error) {
                console.error('切换自动重启失败:', error);
                this.showMessage('切换自动重启失败', 'error');
            }
        },

        async deleteBot(botId) {
            if (!confirm(`确定要删除机器人 ${botId} 吗？这将删除所有相关文件。`)) return;

            try {
                const response = await fetch(`/api/bots/${botId}`, {
                    method: 'DELETE'
                });
                const data = await response.json();
                
                if (data.success) {
                    this.showMessage(data.message, 'success');
                    this.loadBots();
                } else {
                    this.showMessage(data.message, 'error');
                }
            } catch (error) {
                console.error('删除机器人失败:', error);
                this.showMessage('删除机器人失败', 'error');
            }
        },

        // 添加机器人 - 修改：使用配置文件中的签名服务器设置（默认为空）
        async addBot() {
            if (!this.newBot.id || !this.newBot.uin) {
                this.showMessage('请填写完整的机器人信息', 'error');
                return;
            }

            try {
                const configData = {
                    "$schema": "https://raw.githubusercontent.com/LagrangeDev/Lagrange.Core/master/Lagrange.OneBot/Resources/appsettings_schema.json",
                    "Account": {
                        "Uin": parseInt(this.newBot.uin),
                        "Password": "",
                        "Protocol": this.newBot.protocol,
                        "AutoReconnect": true,
                        "GetOptimumServer": true
                    },
                    "Message": {
                        "IgnoreSelf": true,
                        "StringPost": false
                    },
                    "QrCode": {
                        "ConsoleCompatibilityMode": false
                    },
                    "Logging": {
                        "LogLevel": {
                            "Default": "Information",
                            "Microsoft": "Warning",
                            "Microsoft.Hosting.Lifetime": "Information"
                        }
                    },
                    // 修改：使用配置文件中的默认签名服务器（默认为空）
                    "SignServerUrl": this.settings.defaultSignServer || "",
                    "SignProxyUrl": "",
                    "MusicSignServerUrl": "",
                    "Implementations": [
                        {
                            "Type": "ForwardWebSocket",
                            "Host": "127.0.0.1",
                            "Port": parseInt(this.newBot.port) || 8081,
                            "HeartBeatInterval": 5000,
                            "HeartBeatEnable": true,
                            "AccessToken": this.newBot.accessToken || ""
                        }
                    ]
                };

                const response = await fetch('/api/bots', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        botId: this.newBot.id,
                        config: configData
                    })
                });

                const data = await response.json();
                
                if (data.success) {
                    this.showMessage(data.message, 'success');
                    this.closeModals();
                    this.resetNewBotForm();
                    this.loadBots();
                } else {
                    this.showMessage(data.message, 'error');
                }
            } catch (error) {
                console.error('添加机器人失败:', error);
                this.showMessage('添加机器人失败', 'error');
            }
        },

        resetNewBotForm() {
            this.newBot = {
                id: '',
                uin: '',
                protocol: 'Linux',
                port: 8081,
                accessToken: ''
            };
        },

        // 配置相关
        async openConfigModal(bot) {
            this.currentBot = bot;
            
            try {
                const response = await fetch(`/api/bots/${bot.id}/config/simple`);
                
                if (response.ok) {
                    this.botConfig = await response.json();
                } else {
                    const createResponse = await fetch(`/api/bots/${bot.id}/config/create-default`, {
                        method: 'POST'
                    });
                    if (createResponse.ok) {
                        const createData = await createResponse.json();
                        if (createData.success && createData.config) {
                            this.botConfig = this.convertToSimpleConfig(createData.config);
                        }
                    }
                }
                
                // 确保implementations存在
                if (!this.botConfig.implementations) {
                    this.botConfig.implementations = [];
                }
                
                // 确保signServer存在，使用空的默认值
                if (!this.botConfig.signServer) {
                    this.botConfig.signServer = {
                        url: this.settings.defaultSignServer || '',
                        proxyUrl: '',
                        musicUrl: ''
                    };
                }
                
                this.showConfigModal = true;
                this.configTab = 'basic';
            } catch (error) {
                console.error('加载配置失败:', error);
                this.showMessage(`加载配置失败: ${error.message}`, 'error');
            }
        },

        convertToSimpleConfig(fullConfig) {
            return {
                account: {
                    uin: fullConfig.Account?.Uin || 0,
                    protocol: fullConfig.Account?.Protocol || 'Linux',
                    autoReconnect: fullConfig.Account?.AutoReconnect !== false,
                    getOptimumServer: fullConfig.Account?.GetOptimumServer !== false
                },
                message: {
                    ignoreSelf: fullConfig.Message?.IgnoreSelf !== false,
                    stringPost: fullConfig.Message?.StringPost === true
                },
                qrCode: {
                    consoleCompatibilityMode: fullConfig.QrCode?.ConsoleCompatibilityMode === true
                },
                logging: {
                    logLevel: fullConfig.Logging?.LogLevel?.Default || 'Information'
                },
                signServer: {
                    url: fullConfig.SignServerUrl || this.settings.defaultSignServer || '',
                    proxyUrl: fullConfig.SignProxyUrl || '',
                    musicUrl: fullConfig.MusicSignServerUrl || ''
                },
                implementations: fullConfig.Implementations || []
            };
        },

        async saveConfig() {
            try {
                let endpoint, data;
                
                if (this.configTab === 'raw') {
                    try {
                        data = JSON.parse(this.rawConfig);
                        endpoint = `/api/bots/${this.currentBot.id}/config/raw`;
                    } catch (e) {
                        this.showMessage('JSON格式错误，请检查配置', 'error');
                        return;
                    }
                } else {
                    endpoint = `/api/bots/${this.currentBot.id}/config/simple`;
                    data = this.botConfig;
                }

                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });

                if (response.ok) {
                    const result = await response.json();
                    if (result.success) {
                        this.showMessage(result.message, 'success');
                        this.closeModals();
                        this.loadBots();
                    } else {
                        this.showMessage(result.message, 'error');
                    }
                } else {
                    const errorText = await response.text();
                    this.showMessage(`保存配置失败: HTTP ${response.status} - ${errorText}`, 'error');
                }
            } catch (error) {
                console.error('保存配置失败:', error);
                this.showMessage(`保存配置失败: ${error.message}`, 'error');
            }
        },

        async loadRawConfig() {
            if (!this.currentBot) return;
            
            try {
                const response = await fetch(`/api/bots/${this.currentBot.id}/config/raw`);
                if (response.ok) {
                    const config = await response.json();
                    this.rawConfig = JSON.stringify(config, null, 2);
                }
            } catch (error) {
                console.error('加载原始配置失败:', error);
            }
        },

        formatRawConfig() {
            try {
                const parsed = JSON.parse(this.rawConfig);
                this.rawConfig = JSON.stringify(parsed, null, 2);
                this.showMessage('配置格式化成功', 'success');
            } catch (error) {
                this.showMessage('JSON格式错误，无法格式化', 'error');
            }
        },

        validateRawConfig() {
            try {
                JSON.parse(this.rawConfig);
                this.showMessage('配置格式正确', 'success');
            } catch (error) {
                this.showMessage('JSON格式错误: ' + error.message, 'error');
            }
        },

        async resetToDefault() {
            if (!confirm('确定要重置为默认配置吗？这将覆盖当前配置。')) return;
            
            try {
                const response = await fetch(`/api/bots/${this.currentBot.id}/config/create-default`, {
                    method: 'POST'
                });
                const data = await response.json();
                
                if (data.success) {
                    this.rawConfig = JSON.stringify(data.config, null, 2);
                    this.showMessage('已重置为默认配置', 'success');
                } else {
                    this.showMessage('重置失败: ' + data.message, 'error');
                }
            } catch (error) {
                console.error('重置配置失败:', error);
                this.showMessage('重置配置失败', 'error');
            }
        },

        // 修改addImplementation方法，默认使用ForwardWebSocket
        addImplementation() {
            this.botConfig.implementations.push({
                Type: 'ForwardWebSocket',
                Host: '127.0.0.1',
                Port: 8081,
                HeartBeatInterval: 5000,
                HeartBeatEnable: true,
                AccessToken: ''
            });
        },

        removeImplementation(index) {
            if (this.botConfig.implementations.length > 1) {
                this.botConfig.implementations.splice(index, 1);
            }
        },

        // 日志相关 - 优化：懒加载，只有打开日志才加载
        async openLogsModal(bot) {
            this.currentBot = bot;
            this.showLogsModal = true;
            this.logsLoaded = false;
            this.currentBotLogs = []; // 清空之前的日志
            
            try {
                // 显示加载状态
                this.loading = true;
                this.loadingText = '加载日志中...';
                
                // 懒加载：只有打开日志模态框时才从服务器加载日志
                const response = await fetch(`/api/logs/${bot.id}`);
                if (response.ok) {
                    const logs = await response.json();
                    // 限制日志数量，只显示最近的200条避免界面卡顿
                    this.currentBotLogs = logs.slice(0, 200);
                    this.logsLoaded = true;
                } else {
                    this.currentBotLogs = [];
                    this.showMessage('加载日志失败', 'error');
                }
            } catch (error) {
                console.error('加载日志失败:', error);
                this.showMessage('加载日志失败', 'error');
                this.currentBotLogs = [];
            } finally {
                this.loading = false;
                this.loadingText = '';
            }
        },

        async clearBotLogs() {
            if (confirm('确定要清空当前机器人的日志吗？')) {
                try {
                    const response = await fetch(`/api/logs/${this.currentBot.id}`, {
                        method: 'DELETE'
                    });
                    
                    if (response.ok) {
                        this.currentBotLogs = [];
                        this.showMessage('日志已清空', 'success');
                    } else {
                        this.showMessage('清空日志失败', 'error');
                    }
                } catch (error) {
                    console.error('清空日志失败:', error);
                    this.showMessage('清空日志失败', 'error');
                }
            }
        },

        downloadBotLogs() {
            if (this.currentBotLogs.length === 0) {
                this.showMessage('没有日志可下载', 'warning');
                return;
            }

            const logs = this.currentBotLogs.map(log => 
                `[${log.time}] [${log.type.toUpperCase()}] ${log.message}`
            ).join('\n');

            const blob = new Blob([logs], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${this.currentBot.id}_logs.txt`;
            a.click();
            URL.revokeObjectURL(url);
            
            this.showMessage('日志下载完成', 'success');
        },

        clearGlobalLogs() {
            if (confirm('确定要清空全局日志吗？')) {
                this.globalLogs = [];
                this.showMessage('全局日志已清空', 'success');
            }
        },

        // 设置相关
        async saveSettings() {
            try {
                this.loading = true;
                this.loadingText = '保存设置中...';

                const response = await fetch('/api/config', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(this.settings)
                });

                const data = await response.json();
                
                if (data.success) {
                    this.showMessage(data.message, 'success');
                    this.closeModals();
                } else {
                    this.showMessage(data.message, 'error');
                }
            } catch (error) {
                console.error('保存设置失败:', error);
                this.showMessage('保存设置失败', 'error');
            } finally {
                this.loading = false;
                this.loadingText = '';
            }
        },

        async resetSettings() {
            if (!confirm('确定要重置所有设置为默认值吗？')) return;
            
            try {
                await this.loadSettings();
                this.showMessage('设置已重置', 'success');
            } catch (error) {
                console.error('重置设置失败:', error);
                this.showMessage('重置设置失败', 'error');
            }
        },

        async refreshSystemInfo() {
            await this.loadSystemInfo();
            this.showMessage('系统信息已刷新', 'success');
        },

        async clearSystemLogs() {
            if (!confirm('确定要清理系统日志吗？')) return;
            
            try {
                const response = await fetch('/api/system/clear-logs', {
                    method: 'POST'
                });
                const data = await response.json();
                
                if (data.success) {
                    this.showMessage(data.message, 'success');
                } else {
                    this.showMessage(data.message, 'error');
                }
            } catch (error) {
                console.error('清理日志失败:', error);
                this.showMessage('清理日志失败', 'error');
            }
        },

        async restartServer() {
            if (!confirm('确定要重启服务器吗？这将断开所有连接。')) return;
            
            try {
                const response = await fetch('/api/system/restart', {
                    method: 'POST'
                });
                const data = await response.json();
                
                if (data.success) {
                    this.showMessage(data.message, 'success');
                    setTimeout(() => {
                        window.location.reload();
                    }, 3000);
                } else {
                    this.showMessage(data.message, 'error');
                }
            } catch (error) {
                console.error('重启服务器失败:', error);
                this.showMessage('重启服务器失败', 'error');
            }
        },

        // 连接信息相关
        async copyToClipboard(text) {
            try {
                await navigator.clipboard.writeText(text);
                this.showMessage('已复制到剪贴板', 'success');
            } catch (error) {
                const textArea = document.createElement('textarea');
                textArea.value = text;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                this.showMessage('已复制到剪贴板', 'success');
            }
        },

        async openConnectionModal() {
            this.showConnectionModal = true;
            await this.loadConnectionInfo();
        },

        getBotImplementations(bot) {
            return bot.implementations || [
                {
                    Type: 'ForwardWebSocket',
                    Host: '127.0.0.1',
                    Port: 8081
                }
            ];
        },

        formatConnectionAddress(impl, currentHost, currentPort) {
            const managerPort = currentPort;

            switch (impl.Type) {
                case 'ForwardWebSocket':
                    return `ws://${impl.Host}:${impl.Port}/`;
                case 'ReverseWebSocket':
                    return `${currentHost}:${managerPort}/ws/${this.currentBot?.id || 'botId'}/ws`;
                case 'Http':
                    return `http://${impl.Host}:${impl.Port}/`;
                case 'ReverseHttp':
                    return `${currentHost}:${managerPort}/http/${this.currentBot?.id || 'botId'}/`;
                default:
                    return `${impl.Host}:${impl.Port}`;
            }
        },

        getConnectionDescription(impl) {
            switch (impl.Type) {
                case 'ForwardWebSocket':
                    return '正向WebSocket - 机器人监听，外部主动连接';
                case 'ReverseWebSocket':
                    return '反向WebSocket - 机器人主动连接外部服务';
                case 'Http':
                    return 'HTTP接口 - RESTful API';
                case 'ReverseHttp':
                    return '反向HTTP - 推送到外部HTTP服务';
                default:
                    return '未知连接类型';
            }
        },

        getConnectionTypeIcon(type) {
            const icons = {
                'ReverseWebSocket': 'fas fa-exchange-alt',
                'ForwardWebSocket': 'fas fa-arrow-right',
                'Http': 'fas fa-globe',
                'ReverseHttp': 'fas fa-upload',
                'Unified': 'fas fa-network-wired'
            };
            return icons[type] || 'fas fa-plug';
        },

        getConnectionTypeText(type) {
            const texts = {
                'ReverseWebSocket': '反向WebSocket',
                'ForwardWebSocket': '正向WebSocket', 
                'Http': 'HTTP接口',
                'ReverseHttp': '反向HTTP',
                'Unified': '统一转发'
            };
            return texts[type] || type;
        },

        getBotConnectionStatus(botId) {
            const bot = this.bots.find(b => b.id === botId);
            if (!bot) return 'unknown';
            
            if (bot.status === 'running' && bot.loginStatus === 'online') {
                return 'online';
            } else if (bot.status === 'running') {
                return 'running';
            } else {
                return 'offline';
            }
        },

        getConnectionStatusText(status) {
            const texts = {
                'online': '在线',
                'running': '运行中',
                'offline': '离线',
                'unknown': '未知'
            };
            return texts[status] || '未知';
        },

        // 二维码相关 - 改进版本，实现扫码登录成功后自动关闭
        async openQrModal(bot, qrUrl = null, uin = null, isOffline = false) {
            this.currentQrBot = {
                ...bot,
                qrUrl: qrUrl,
                uin: uin,
                isOffline: isOffline,
                lastCheck: Date.now()
            };
            this.showQrModal = true;
            
            if (!qrUrl) {
                await this.refreshQrCode();
            }
        },

        async refreshQrCode() {
            if (!this.currentQrBot) return;
            
            try {
                const response = await fetch(`/api/bots/${this.currentQrBot.id}/qrcode/check`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.success && data.hasQrCode) {
                        this.currentQrBot.qrUrl = data.qrCodeUrl;
                        this.currentQrBot.uin = data.uin;
                        this.showMessage('二维码已刷新', 'success');
                    } else {
                        this.showMessage(data.message || '未检测到二维码', 'warning');
                    }
                }
            } catch (error) {
                console.error('刷新二维码失败:', error);
                this.showMessage('刷新二维码失败', 'error');
            }
        },

        async regenerateQrCode() {
            if (!this.currentQrBot) return;
            
            try {
                this.loading = true;
                this.loadingText = '正在重新生成二维码...';
                
                const response = await fetch(`/api/bots/${this.currentQrBot.id}/qrcode/refresh`, {
                    method: 'POST'
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.success) {
                        this.showMessage(data.message, 'success');
                        setTimeout(() => {
                            this.refreshQrCode();
                        }, 3000);
                    } else {
                        this.showMessage(data.message, 'error');
                    }
                }
            } catch (error) {
                console.error('重新生成二维码失败:', error);
                this.showMessage('重新生成二维码失败', 'error');
            } finally {
                this.loading = false;
                this.loadingText = '';
            }
        },

        async deleteQrCode() {
            if (!this.currentQrBot) return;
            
            try {
                const response = await fetch(`/api/bots/${this.currentQrBot.id}/qrcode`, {
                    method: 'DELETE'
                });
                
                if (response.ok) {
                    const data = await response.json();
                    this.showMessage(data.message, 'success');
                    this.currentQrBot.qrUrl = null;
                } else {
                    this.showMessage('删除二维码失败', 'error');
                }
            } catch (error) {
                console.error('删除二维码失败:', error);
                this.showMessage('删除二维码失败', 'error');
            }
        },

        // 修改：扫码模态框关闭逻辑，只有在线才能关闭
        async closeQrModal() {
            if (!this.currentQrBot) return;
            
            const bot = this.bots.find(b => b.id === this.currentQrBot.id);
            if (bot && bot.loginStatus === 'online') {
                await this.deleteQrCode();
                this.showQrModal = false;
                this.currentQrBot = null;
                this.showMessage('登录成功，二维码已清理', 'success');
            } else {
                this.showMessage('请等待机器人上线后自动关闭，或手动删除二维码', 'warning');
            }
        },

        // 修改：关闭二维码模态框并删除二维码 - 扫码登录成功后自动调用
        async closeQrModalAndDeleteQr() {
            if (!this.currentQrBot) return;
            
            try {
                await this.deleteQrCode();
                this.showQrModal = false;
                this.currentQrBot = null;
                this.showMessage('登录成功，界面已自动关闭', 'success');
            } catch (error) {
                console.error('清理二维码失败:', error);
                this.showMessage('清理二维码失败', 'error');
            }
        },

        async forceCloseQrModal() {
            if (!this.currentQrBot) return;
            
            if (confirm('确定要强制关闭扫码界面吗？这将删除二维码文件。')) {
                try {
                    await this.deleteQrCode();
                    this.showQrModal = false;
                    this.currentQrBot = null;
                    this.showMessage('已强制关闭并清理二维码', 'info');
                } catch (error) {
                    console.error('强制关闭失败:', error);
                    this.showMessage('强制关闭失败', 'error');
                }
            }
        },

        showQrModalForBot(bot) {
            this.openQrModal(bot);
        },

        // UI相关
        closeModals() {
            this.showAddBotModal = false;
            this.showConfigModal = false;
            this.showLogsModal = false;
            this.showSettingsModal = false;
            this.showConnectionModal = false;
            this.currentBot = null;
            this.currentBotLogs = [];
            this.logsLoaded = false; // 重置日志加载状态
        },

        // 工具方法
        getStatusIcon(status) {
            const icons = {
                'running': 'fas fa-play-circle',
                'stopped': 'fas fa-stop-circle',
                'starting': 'fas fa-spinner fa-spin',
                'stopping': 'fas fa-spinner fa-spin',
                'restarting': 'fas fa-redo',
                'error': 'fas fa-exclamation-circle'
            };
            return icons[status] || 'fas fa-question-circle';
        },

        getStatusText(status) {
            const texts = {
                'running': '运行中',
                'stopped': '已停止',
                'starting': '启动中',
                'stopping': '停止中',
                'restarting': '重启中',
                'error': '错误'
            };
            return texts[status] || '未知';
        },

        getLoginStatusText(loginStatus) {
            const texts = {
                'online': '在线',
                'offline': '离线',
                'error': '错误'
            };
            return texts[loginStatus] || '未知';
        },

        getMessageIcon(type) {
            const icons = {
                'success': 'fas fa-check-circle',
                'error': 'fas fa-exclamation-circle',
                'warning': 'fas fa-exclamation-triangle',
                'info': 'fas fa-info-circle'
            };
            return icons[type] || 'fas fa-info-circle';
        },

        showMessage(text, type = 'info') {
            if (this.messageTimeout) {
                clearTimeout(this.messageTimeout);
            }

            this.message = { text, type };
            
            this.messageTimeout = setTimeout(() => {
                this.message = null;
            }, 5000);
        },

        formatUptime(seconds) {
            if (!seconds) return '0秒';
            
            const days = Math.floor(seconds / 86400);
            const hours = Math.floor((seconds % 86400) / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            
            if (days > 0) {
                return `${days}天 ${hours}小时 ${minutes}分钟`;
            } else if (hours > 0) {
                return `${hours}小时 ${minutes}分钟`;
            } else {
                return `${minutes}分钟`;
            }
        },

        formatMemory(memoryUsage) {
            if (!memoryUsage) return '未知';
            
            const formatBytes = (bytes) => {
                if (bytes === 0) return '0 B';
                const k = 1024;
                const sizes = ['B', 'KB', 'MB', 'GB'];
                const i = Math.floor(Math.log(bytes) / Math.log(k));
                return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
            };

            return `${formatBytes(memoryUsage.rss)} / ${formatBytes(memoryUsage.heapTotal)}`;
        }
    },

    watch: {
        configTab(newTab) {
            if (newTab === 'raw') {
                this.loadRawConfig();
            }
        }
    }
}).mount('#app');
