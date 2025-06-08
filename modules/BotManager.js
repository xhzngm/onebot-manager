const fs = require('fs-extra');
const path = require('path');
const ProcessManager = require('./ProcessManager');

class BotManager {
    constructor(config, io) {
        this.config = config;
        this.io = io;
        this.processManager = new ProcessManager(config);
        this.bots = new Map(); // botId -> bot配置和状态
        this.isClientConnected = false;
        this.statusCheckInterval = null;
        this.qrCodeCheckInterval = null;
        this.qrTimeouts = new Map(); // botId -> timeout for auto exit
        
        // 设置ProcessManager日志事件监听
        this.processManager.on('log', (logEntry) => {
            this.handleProcessLog(logEntry);
        });
        
        // 确保机器人根目录存在
        this.ensureBotRootDir();
    }

    // 处理来自ProcessManager的日志
    handleProcessLog(logEntry) {
        const { botId, timestamp, time, type, message } = logEntry;
        
        // 发送到客户端
        if (this.isClientConnected) {
            this.io.emit('botLog', {
                botId: botId,
                timestamp,
                time,
                type,
                message
            });
        }
    }

    async ensureBotRootDir() {
        try {
            await fs.ensureDir(this.config.botRootDir);
            console.log(`机器人根目录已确保存在: ${this.config.botRootDir}`);
        } catch (error) {
            console.error('创建机器人根目录失败:', error);
        }
    }

    async init() {
        try {
            console.log('初始化机器人管理器...');
            
            // 加载现有机器人配置
            await this.loadExistingBots();
            
            // 启动状态检查
            this.startStatusCheck();
            this.startQrCodeCheck();
            
            console.log(`机器人管理器初始化完成，加载了 ${this.bots.size} 个机器人`);
        } catch (error) {
            console.error('初始化机器人管理器失败:', error);
        }
    }

    // 加载现有机器人配置
    async loadExistingBots() {
        try {
            const botRootDir = path.resolve(this.config.botRootDir);
            
            if (!await fs.pathExists(botRootDir)) {
                console.log('机器人根目录不存在，创建中...');
                await fs.ensureDir(botRootDir);
                return;
            }

            const entries = await fs.readdir(botRootDir, { withFileTypes: true });
            const botDirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);

            for (const botId of botDirs) {
                const botDir = path.join(botRootDir, botId);
                const configFile = path.join(botDir, 'appsettings.json');
                
                if (await fs.pathExists(configFile)) {
                    try {
                        const config = await fs.readJson(configFile);
                        
                        // 修复Implementations读取错误 - 确保字段存在
                        if (!config.Implementations) {
                            console.warn(`机器人 ${botId} 配置缺少 Implementations 字段，自动修复...`);
                            config.Implementations = [
                                {
                                    "Type": "ForwardWebSocket",
                                    "Host": "127.0.0.1",
                                    "Port": 8081,
                                    "HeartBeatInterval": 5000,
                                    "HeartBeatEnable": true,
                                    "AccessToken": ""
                                }
                            ];
                            
                            // 保存修复后的配置
                            await fs.writeJson(configFile, config, { spaces: 2 });
                        }

                        // 确保SignServerUrl存在，使用空的签名服务器
                        if (!config.SignServerUrl) {
                            config.SignServerUrl = this.config.defaultSignServer || "";
                            await fs.writeJson(configFile, config, { spaces: 2 });
                        }

                        const botInfo = {
                            id: botId,
                            uin: config.Account?.Uin || 0,
                            protocol: config.Account?.Protocol || 'Linux',
                            status: 'stopped',
                            loginStatus: 'offline',
                            statusMessage: '',
                            hasQrCode: false,
                            qrCodePath: null,
                            autoRestart: true,
                            restartCount: 0,
                            lastUpdate: Date.now(),
                            config: config,
                            configPath: configFile,
                            implementations: config.Implementations || [],
                            isOnline: false,
                            lastOnlineCheck: null,
                            qrCodeStartTime: null // 扫码开始时间
                        };

                        this.bots.set(botId, botInfo);
                        
                        console.log(`加载机器人: ${botId} (UIN: ${botInfo.uin})`);
                    } catch (error) {
                        console.error(`加载机器人 ${botId} 配置失败:`, error);
                    }
                }
            }
        } catch (error) {
            console.error('加载现有机器人失败:', error);
        }
    }

    // 创建新机器人 - 修复默认配置和Implementations错误，使用空的签名服务器
    async createBot(botId, config) {
        try {
            if (this.bots.has(botId)) {
                return { success: false, message: '机器人ID已存在' };
            }

            const botDir = path.join(this.config.botRootDir, botId);
            const configPath = path.join(botDir, 'appsettings.json');

            // 创建机器人目录
            await fs.ensureDir(botDir);

            // 确保配置完整性，修复Implementations问题，使用空的签名服务器
            const fullConfig = {
                "$schema": "https://raw.githubusercontent.com/LagrangeDev/Lagrange.Core/master/Lagrange.OneBot/Resources/appsettings_schema.json",
                "Account": {
                    "Uin": config.Account?.Uin || 0,
                    "Password": "",
                    "Protocol": config.Account?.Protocol || "Linux",
                    "AutoReconnect": config.Account?.AutoReconnect !== false,
                    "GetOptimumServer": config.Account?.GetOptimumServer !== false
                },
                "Message": {
                    "IgnoreSelf": config.Message?.IgnoreSelf !== false,
                    "StringPost": config.Message?.StringPost === true
                },
                "QrCode": {
                    "ConsoleCompatibilityMode": config.QrCode?.ConsoleCompatibilityMode === true
                },
                "Logging": {
                    "LogLevel": {
                        "Default": config.Logging?.LogLevel?.Default || "Information",
                        "Microsoft": "Warning",
                        "Microsoft.Hosting.Lifetime": "Information"
                    }
                },
                // 使用空的签名服务器
                "SignServerUrl": config.SignServerUrl || this.config.defaultSignServer || "",
                "SignProxyUrl": config.SignProxyUrl || "",
                "MusicSignServerUrl": config.MusicSignServerUrl || "",
                // 确保Implementations字段存在且格式正确
                "Implementations": config.Implementations && Array.isArray(config.Implementations) 
                    ? config.Implementations 
                    : [
                        {
                            "Type": "ForwardWebSocket",
                            "Host": "127.0.0.1", 
                            "Port": 8081,
                            "HeartBeatInterval": 5000,
                            "HeartBeatEnable": true,
                            "AccessToken": ""
                        }
                    ]
            };

            // 保存配置文件
            await fs.writeJson(configPath, fullConfig, { spaces: 2 });

            // 创建机器人信息
            const botInfo = {
                id: botId,
                uin: fullConfig.Account.Uin,
                protocol: fullConfig.Account.Protocol,
                status: 'stopped',
                loginStatus: 'offline',
                statusMessage: '',
                hasQrCode: false,
                qrCodePath: null,
                autoRestart: true,
                restartCount: 0,
                lastUpdate: Date.now(),
                config: fullConfig,
                configPath: configPath,
                implementations: fullConfig.Implementations,
                isOnline: false,
                lastOnlineCheck: null,
                qrCodeStartTime: null
            };

            this.bots.set(botId, botInfo);

            // 通知客户端
            this.emitBotListUpdate();

            console.log(`机器人 ${botId} 创建成功`);
            return { success: true, message: '机器人创建成功', botInfo };

        } catch (error) {
            console.error(`创建机器人 ${botId} 失败:`, error);
            return { success: false, message: `创建失败: ${error.message}` };
        }
    }

    // 启动机器人
    async startBot(botId) {
        try {
            const bot = this.bots.get(botId);
            if (!bot) {
                return { success: false, message: '机器人不存在' };
            }

            if (bot.status === 'running' || bot.status === 'starting') {
                return { success: false, message: '机器人已在运行或正在启动' };
            }

            // 更新状态
            bot.status = 'starting';
            bot.statusMessage = '正在启动...';
            bot.lastUpdate = Date.now();
            this.emitBotStatusUpdate(botId);

            // 启动进程
            const result = await this.processManager.startBot(
                botId, 
                bot.configPath, 
                this.config.executablePath
            );

            if (result.success) {
                bot.status = 'running';
                bot.statusMessage = '运行中';
                bot.lastUpdate = Date.now();
                
                // 启动扫码超时检测
                this.startQrCodeTimeout(botId);
            } else {
                bot.status = 'stopped';
                bot.statusMessage = `启动失败: ${result.error}`;
                bot.lastUpdate = Date.now();
            }

            this.emitBotStatusUpdate(botId);
            return result;

        } catch (error) {
            console.error(`启动机器人 ${botId} 失败:`, error);
            const bot = this.bots.get(botId);
            if (bot) {
                bot.status = 'stopped';
                bot.statusMessage = `启动失败: ${error.message}`;
                bot.lastUpdate = Date.now();
                this.emitBotStatusUpdate(botId);
            }
            return { success: false, message: error.message };
        }
    }

    // 启动扫码超时检测 - 长时间不扫码自动退出
    startQrCodeTimeout(botId) {
        this.clearQrCodeTimeout(botId);
        
        const timeout = setTimeout(async () => {
            const bot = this.bots.get(botId);
            if (bot && bot.status === 'running' && bot.loginStatus !== 'online') {
                console.log(`机器人 ${botId} 长时间未登录，自动停止进程`);
                await this.stopBot(botId);
                
                bot.statusMessage = '长时间未登录，已自动停止';
                this.emitBotStatusUpdate(botId);
                this.io.emit('botAutoExit', { 
                    botId: botId, 
                    reason: '长时间未登录，已自动停止进程' 
                });
            }
        }, 300000); // 5分钟超时
        
        this.qrTimeouts.set(botId, timeout);
    }

    // 清除扫码超时检测
    clearQrCodeTimeout(botId) {
        const timeout = this.qrTimeouts.get(botId);
        if (timeout) {
            clearTimeout(timeout);
            this.qrTimeouts.delete(botId);
        }
    }

    // 停止机器人
    async stopBot(botId) {
        try {
            const bot = this.bots.get(botId);
            if (!bot) {
                return { success: false, message: '机器人不存在' };
            }

            if (bot.status === 'stopped' || bot.status === 'stopping') {
                return { success: false, message: '机器人已停止或正在停止' };
            }

            // 清除扫码超时检测
            this.clearQrCodeTimeout(botId);

            // 更新状态
            bot.status = 'stopping';
            bot.statusMessage = '正在停止...';
            bot.lastUpdate = Date.now();
            this.emitBotStatusUpdate(botId);

            // 停止进程
            const result = await this.processManager.stopBot(botId);

            bot.status = 'stopped';
            bot.statusMessage = result.success ? '已停止' : `停止失败: ${result.error}`;
            bot.loginStatus = 'offline';
            bot.hasQrCode = false;
            bot.qrCodePath = null;
            bot.isOnline = false;
            bot.qrCodeStartTime = null;
            bot.lastUpdate = Date.now();

            this.emitBotStatusUpdate(botId);
            return result;

        } catch (error) {
            console.error(`停止机器人 ${botId} 失败:`, error);
            const bot = this.bots.get(botId);
            if (bot) {
                bot.status = 'stopped';
                bot.statusMessage = `停止失败: ${error.message}`;
                bot.lastUpdate = Date.now();
                this.emitBotStatusUpdate(botId);
            }
            return { success: false, message: error.message };
        }
    }

    // 重启机器人
    async restartBot(botId) {
        try {
            const bot = this.bots.get(botId);
            if (!bot) {
                return { success: false, message: '机器人不存在' };
            }

            // 清除扫码超时检测
            this.clearQrCodeTimeout(botId);

            // 更新状态
            bot.status = 'restarting';
            bot.statusMessage = '正在重启...';
            bot.restartCount++;
            bot.lastUpdate = Date.now();
            this.emitBotStatusUpdate(botId);

            // 重启进程
            const result = await this.processManager.restartBot(
                botId, 
                bot.configPath, 
                this.config.executablePath
            );

            if (result.success) {
                bot.status = 'running';
                bot.statusMessage = '运行中';
                bot.loginStatus = 'offline'; // 重启后需要重新登录
                bot.hasQrCode = false;
                bot.qrCodePath = null;
                bot.isOnline = false;
                bot.qrCodeStartTime = null;
                
                // 启动新的扫码超时检测
                this.startQrCodeTimeout(botId);
            } else {
                bot.status = 'stopped';
                bot.statusMessage = `重启失败: ${result.error}`;
            }

            bot.lastUpdate = Date.now();
            this.emitBotStatusUpdate(botId);
            return result;

        } catch (error) {
            console.error(`重启机器人 ${botId} 失败:`, error);
            const bot = this.bots.get(botId);
            if (bot) {
                bot.status = 'stopped';
                bot.statusMessage = `重启失败: ${error.message}`;
                bot.lastUpdate = Date.now();
                this.emitBotStatusUpdate(botId);
            }
            return { success: false, message: error.message };
        }
    }

    // 重启所有机器人
    async restartAllBots() {
        try {
            console.log('开始重启所有机器人...');
            const results = [];
            
            for (const [botId, bot] of this.bots) {
                if (bot.status === 'running') {
                    console.log(`重启机器人: ${botId}`);
                    const result = await this.restartBot(botId);
                    results.push({ botId, result });
                    
                    // 添加延迟避免同时重启造成资源争用
                    await this.sleep(2000);
                }
            }
            
            const successCount = results.filter(r => r.result.success).length;
            const message = `重启完成，成功: ${successCount}/${results.length}`;
            
            console.log(message);
            return { success: true, message, results };
            
        } catch (error) {
            console.error('重启所有机器人失败:', error);
            return { success: false, message: error.message };
        }
    }

    // 删除机器人
    async deleteBot(botId) {
        try {
            const bot = this.bots.get(botId);
            if (!bot) {
                return { success: false, message: '机器人不存在' };
            }

            // 先停止机器人
            if (bot.status === 'running') {
                await this.stopBot(botId);
            }

            // 清除扫码超时检测
            this.clearQrCodeTimeout(botId);

            // 删除机器人目录
            const botDir = path.join(this.config.botRootDir, botId);
            if (await fs.pathExists(botDir)) {
                await fs.remove(botDir);
            }

            // 从内存中移除
            this.bots.delete(botId);

            // 通知客户端
            this.emitBotListUpdate();

            console.log(`机器人 ${botId} 已删除`);
            return { success: true, message: '机器人删除成功' };

        } catch (error) {
            console.error(`删除机器人 ${botId} 失败:`, error);
            return { success: false, message: `删除失败: ${error.message}` };
        }
    }

    // 切换自动重启
    async toggleAutoRestart(botId) {
        try {
            const bot = this.bots.get(botId);
            if (!bot) {
                return { success: false, message: '机器人不存在' };
            }

            bot.autoRestart = !bot.autoRestart;
            bot.lastUpdate = Date.now();

            this.emitBotStatusUpdate(botId);
            
            const message = `自动重启已${bot.autoRestart ? '启用' : '禁用'}`;
            return { success: true, message, autoRestart: bot.autoRestart };

        } catch (error) {
            console.error(`切换自动重启失败:`, error);
            return { success: false, message: error.message };
        }
    }

    // 获取机器人配置 - 修复Implementations读取错误
    async getBotConfig(botId) {
        try {
            const bot = this.bots.get(botId);
            if (!bot) {
                throw new Error('机器人不存在');
            }

            // 从文件重新读取最新配置
            const config = await fs.readJson(bot.configPath);
            
            // 确保Implementations字段存在
            if (!config.Implementations) {
                console.warn(`机器人 ${botId} 配置缺少 Implementations 字段，自动修复...`);
                config.Implementations = [
                    {
                        "Type": "ForwardWebSocket",
                        "Host": "127.0.0.1",
                        "Port": 8081,
                        "HeartBeatInterval": 5000,
                        "HeartBeatEnable": true,
                        "AccessToken": ""
                    }
                ];
                
                // 保存修复后的配置
                await fs.writeJson(bot.configPath, config, { spaces: 2 });
            }

            // 更新机器人信息中的配置
            bot.config = config;
            bot.implementations = config.Implementations || [];

            return config;

        } catch (error) {
            console.error(`获取机器人 ${botId} 配置失败:`, error);
            throw error;
        }
    }

    // 保存机器人配置 - 修复500错误，使用空的签名服务器
    async saveBotConfig(botId, config) {
        try {
            const bot = this.bots.get(botId);
            if (!bot) {
                throw new Error('机器人不存在');
            }

            // 验证配置格式
            if (typeof config !== 'object' || config === null) {
                throw new Error('配置格式无效');
            }

            // 确保必要字段存在
            if (!config.Account) {
                config.Account = { Uin: 0, Protocol: "Linux" };
            }

            if (!config.Implementations || !Array.isArray(config.Implementations)) {
                config.Implementations = [
                    {
                        "Type": "ForwardWebSocket",
                        "Host": "127.0.0.1",
                        "Port": 8081,
                        "HeartBeatInterval": 5000,
                        "HeartBeatEnable": true,
                        "AccessToken": ""
                    }
                ];
            }

            // 确保SignServerUrl存在，使用空的签名服务器
            if (!config.SignServerUrl) {
                config.SignServerUrl = this.config.defaultSignServer || "";
            }

            // 保存到文件
            await fs.writeJson(bot.configPath, config, { spaces: 2 });

            // 更新内存中的配置
            bot.config = config;
            bot.uin = config.Account?.Uin || 0;
            bot.protocol = config.Account?.Protocol || 'Linux';
            bot.implementations = config.Implementations || [];
            bot.lastUpdate = Date.now();

            this.emitBotStatusUpdate(botId);

            console.log(`机器人 ${botId} 配置保存成功`);
            return { success: true, message: '配置保存成功，重启生效' };

        } catch (error) {
            console.error(`保存机器人 ${botId} 配置失败:`, error);
            throw new Error(`保存配置失败: ${error.message}`);
        }
    }

    // 获取简化配置格式
    getSimpleBotConfig(config) {
        return {
            account: {
                uin: config.Account?.Uin || 0,
                protocol: config.Account?.Protocol || 'Linux',
                autoReconnect: config.Account?.AutoReconnect !== false,
                getOptimumServer: config.Account?.GetOptimumServer !== false
            },
            message: {
                ignoreSelf: config.Message?.IgnoreSelf !== false,
                stringPost: config.Message?.StringPost === true
            },
            qrCode: {
                consoleCompatibilityMode: config.QrCode?.ConsoleCompatibilityMode === true
            },
            logging: {
                logLevel: config.Logging?.LogLevel?.Default || 'Information'
            },
            signServer: {
                url: config.SignServerUrl || this.config.defaultSignServer || '',
                proxyUrl: config.SignProxyUrl || '',
                musicUrl: config.MusicSignServerUrl || ''
            },
            implementations: config.Implementations || []
        };
    }

    // 从简化配置转换为完整配置
    convertFromSimpleConfig(simpleConfig) {
        return {
            "$schema": "https://raw.githubusercontent.com/LagrangeDev/Lagrange.Core/master/Lagrange.OneBot/Resources/appsettings_schema.json",
            "Account": {
                "Uin": simpleConfig.account?.uin || 0,
                "Password": "",
                "Protocol": simpleConfig.account?.protocol || "Linux",
                "AutoReconnect": simpleConfig.account?.autoReconnect !== false,
                "GetOptimumServer": simpleConfig.account?.getOptimumServer !== false
            },
            "Message": {
                "IgnoreSelf": simpleConfig.message?.ignoreSelf !== false,
                "StringPost": simpleConfig.message?.stringPost === true
            },
            "QrCode": {
                "ConsoleCompatibilityMode": simpleConfig.qrCode?.consoleCompatibilityMode === true
            },
            "Logging": {
                "LogLevel": {
                    "Default": simpleConfig.logging?.logLevel || "Information",
                    "Microsoft": "Warning",
                    "Microsoft.Hosting.Lifetime": "Information"
                }
            },
            "SignServerUrl": simpleConfig.signServer?.url || this.config.defaultSignServer || "",
            "SignProxyUrl": simpleConfig.signServer?.proxyUrl || "",
            "MusicSignServerUrl": simpleConfig.signServer?.musicUrl || "",
            "Implementations": simpleConfig.implementations && Array.isArray(simpleConfig.implementations) 
                ? simpleConfig.implementations 
                : [
                    {
                        "Type": "ForwardWebSocket",
                        "Host": "127.0.0.1",
                        "Port": 8081,
                        "HeartBeatInterval": 5000,
                        "HeartBeatEnable": true,
                        "AccessToken": ""
                    }
                ]
        };
    }

    // 日志相关方法 - 委托给ProcessManager
    async getBotLogs(botId) {
        return await this.processManager.getBotLogs(botId);
    }

    async clearBotLogs(botId) {
        return await this.processManager.clearBotLogs(botId);
    }

    // 检查机器人在线状态 - 新增功能
    async checkBotOnlineStatus(botId) {
        try {
            const bot = this.bots.get(botId);
            if (!bot || bot.status !== 'running') {
                return false;
            }

            // 获取进程状态
            const processStatus = await this.processManager.getProcessStatus(botId);
            
            if (processStatus && processStatus.isOnline !== undefined) {
                bot.isOnline = processStatus.isOnline;
                bot.lastOnlineCheck = Date.now();
                
                // 如果在线状态改变，更新登录状态
                if (processStatus.isOnline) {
                    if (bot.loginStatus !== 'online') {
                        bot.loginStatus = 'online';
                        bot.hasQrCode = false;
                        bot.qrCodePath = null;
                        bot.qrCodeStartTime = null;
                        
                        // 清除扫码超时检测
                        this.clearQrCodeTimeout(botId);
                        
                        this.emitBotStatusUpdate(botId);
                        this.io.emit('botLoginSuccess', { 
                            botId: botId,
                            autoCloseQr: true // 标记需要自动关闭二维码窗口
                        });
                    }
                } else {
                    if (bot.loginStatus !== 'offline') {
                        bot.loginStatus = 'offline';
                        this.emitBotStatusUpdate(botId);
                    }
                }
                
                return processStatus.isOnline;
            }
            
            return false;
        } catch (error) {
            console.error(`检查机器人 ${botId} 在线状态失败:`, error);
            return false;
        }
    }

    // 状态检查 - 改进版本
    startStatusCheck() {
        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
        }

        this.statusCheckInterval = setInterval(async () => {
            try {
                for (const [botId, bot] of this.bots) {
                    if (bot.status === 'running') {
                        // 检查进程状态
                        const processStatus = await this.processManager.getProcessStatus(botId);
                        
                        if (processStatus.status === 'stopped') {
                            bot.status = 'stopped';
                            bot.statusMessage = '进程已停止';
                            bot.loginStatus = 'offline';
                            bot.hasQrCode = false;
                            bot.qrCodePath = null;
                            bot.isOnline = false;
                            bot.qrCodeStartTime = null;
                            bot.lastUpdate = Date.now();
                            
                            // 清除扫码超时检测
                            this.clearQrCodeTimeout(botId);
                            
                            this.emitBotStatusUpdate(botId);

                            // 自动重启逻辑
                            if (bot.autoRestart && bot.restartCount < 3) { // 使用默认重启次数3
                                console.log(`自动重启机器人 ${botId} (第${bot.restartCount + 1}次)`);
                                setTimeout(() => {
                                    this.restartBot(botId);
                                }, this.config.bot.restartCooldown);
                            }
                        } else {
                            // 检查在线状态
                            await this.checkBotOnlineStatus(botId);
                        }
                    }
                }
            } catch (error) {
                console.error('状态检查失败:', error);
            }
        }, this.config.bot.checkInterval);
    }

    // 二维码检查 - 改进版本，支持扫码登录和自动关闭
    startQrCodeCheck() {
        if (this.qrCodeCheckInterval) {
            clearInterval(this.qrCodeCheckInterval);
        }

        this.qrCodeCheckInterval = setInterval(async () => {
            try {
                for (const [botId, bot] of this.bots) {
                    if (bot.status === 'running') {
                        await this.checkQrCodeForBot(botId, bot);
                    } else if (bot.status === 'stopped') {
                        // 离线状态检查是否有二维码文件需要登录
                        await this.checkOfflineQrCode(botId, bot);
                    }
                }
            } catch (error) {
                console.error('二维码检查失败:', error);
            }
        }, this.config.bot.qrCodeCheckInterval);
    }

    // 检查运行中机器人的二维码
    async checkQrCodeForBot(botId, bot) {
        try {
            const botDir = path.join(this.config.botRootDir, botId);
            const uin = bot.uin || bot.config?.Account?.Uin;
            
            // 检查特定UIN的二维码文件
            let qrCodePath = null;
            if (uin && uin !== 0) {
                qrCodePath = path.join(botDir, `qr-${uin}.png`);
                if (!await fs.pathExists(qrCodePath)) {
                    qrCodePath = null;
                }
            }
            
            // 如果没有特定UIN的二维码，检查通用二维码
            if (!qrCodePath) {
                qrCodePath = path.join(botDir, 'qr-0.png');
                if (!await fs.pathExists(qrCodePath)) {
                    qrCodePath = null;
                }
            }
            
            // 如果还没有，检查所有qr-*.png文件
            if (!qrCodePath && await fs.pathExists(botDir)) {
                const files = await fs.readdir(botDir);
                const qrFiles = files.filter(file => file.startsWith('qr-') && file.endsWith('.png'));
                if (qrFiles.length > 0) {
                    qrCodePath = path.join(botDir, qrFiles[0]);
                }
            }
            
            if (qrCodePath) {
                if (!bot.hasQrCode) {
                    bot.hasQrCode = true;
                    bot.qrCodePath = qrCodePath;
                    bot.qrCodeStartTime = Date.now();
                    bot.lastUpdate = Date.now();
                    
                    this.emitBotStatusUpdate(botId);
                    this.io.emit('qrCodeDetected', {
                        botId: botId,
                        qrPath: qrCodePath.replace(this.config.botRootDir, `/${this.config.botRootDir.replace('./', '')}`),
                        qrUrl: `/${this.config.botRootDir.replace('./', '')}/${botId}/${path.basename(qrCodePath)}`,
                        uin: uin,
                        message: '检测到二维码，请使用QQ/TIM扫码登录',
                        autoShow: true // 自动显示二维码
                    });
                }
            } else if (bot.hasQrCode) {
                // 二维码文件消失，可能已登录
                bot.hasQrCode = false;
                bot.qrCodePath = null;
                bot.qrCodeStartTime = null;
                bot.lastUpdate = Date.now();
                
                // 延迟检查在线状态
                setTimeout(async () => {
                    const isOnline = await this.checkBotOnlineStatus(botId);
                    if (isOnline) {
                        bot.loginStatus = 'online';
                        this.clearQrCodeTimeout(botId);
                        this.emitBotStatusUpdate(botId);
                        this.io.emit('botLoginSuccess', { 
                            botId: botId,
                            autoCloseQr: true
                        });
                    }
                }, 3000);
                
                this.emitBotStatusUpdate(botId);
            }
        } catch (error) {
            console.error(`检查机器人 ${botId} 二维码失败:`, error);
        }
    }

    // 检查离线状态下的二维码 - 新增功能
    async checkOfflineQrCode(botId, bot) {
        try {
            const botDir = path.join(this.config.botRootDir, botId);
            if (!await fs.pathExists(botDir)) {
                return;
            }
            
            const uin = bot.uin || bot.config?.Account?.Uin;
            
            // 检查是否有二维码文件
            let qrCodePath = null;
            if (uin && uin !== 0) {
                qrCodePath = path.join(botDir, `qr-${uin}.png`);
                if (!await fs.pathExists(qrCodePath)) {
                    qrCodePath = null;
                }
            }
            
            if (!qrCodePath) {
                qrCodePath = path.join(botDir, 'qr-0.png');
                if (!await fs.pathExists(qrCodePath)) {
                    qrCodePath = null;
                }
            }
            
            if (!qrCodePath) {
                const files = await fs.readdir(botDir);
                const qrFiles = files.filter(file => file.startsWith('qr-') && file.endsWith('.png'));
                if (qrFiles.length > 0) {
                    qrCodePath = path.join(botDir, qrFiles[0]);
                }
            }
            
            if (qrCodePath && !bot.hasQrCode) {
                bot.hasQrCode = true;
                bot.qrCodePath = qrCodePath;
                bot.qrCodeStartTime = Date.now();
                bot.lastUpdate = Date.now();
                
                this.emitBotStatusUpdate(botId);
                this.io.emit('offlineQrCodeDetected', {
                    botId: botId,
                    qrPath: qrCodePath.replace(this.config.botRootDir, `/${this.config.botRootDir.replace('./', '')}`),
                    qrUrl: `/${this.config.botRootDir.replace('./', '')}/${botId}/${path.basename(qrCodePath)}`,
                    uin: uin,
                    message: '检测到二维码文件，机器人离线状态下需要扫码登录'
                });
            } else if (!qrCodePath && bot.hasQrCode) {
                bot.hasQrCode = false;
                bot.qrCodePath = null;
                bot.qrCodeStartTime = null;
                bot.lastUpdate = Date.now();
                this.emitBotStatusUpdate(botId);
            }
        } catch (error) {
            console.error(`检查机器人 ${botId} 离线二维码失败:`, error);
        }
    }

    // WebSocket事件发射
    emitBotListUpdate() {
        if (this.isClientConnected) {
            this.io.emit('botList', this.getAllBots());
        }
    }

    emitBotStatusUpdate(botId) {
        if (this.isClientConnected) {
            const bot = this.bots.get(botId);
            if (bot) {
                this.io.emit('botStatusChanged', {
                    botId: botId,
                    status: bot.status,
                    loginStatus: bot.loginStatus,
                    isOnline: bot.isOnline || false,
                    hasQrCode: bot.hasQrCode,
                    message: bot.statusMessage,
                    timestamp: bot.lastUpdate
                });
            }
        }
    }

    // 获取器方法
    getAllBots() {
        return Array.from(this.bots.values()).map(bot => ({
            id: bot.id,
            uin: bot.uin,
            protocol: bot.protocol,
            status: bot.status,
            loginStatus: bot.loginStatus,
            statusMessage: bot.statusMessage,
            hasQrCode: bot.hasQrCode,
            qrCodePath: bot.qrCodePath ? bot.qrCodePath.replace(this.config.botRootDir, `/${this.config.botRootDir.replace('./', '')}`) : null,
            autoRestart: bot.autoRestart,
            restartCount: bot.restartCount,
            lastUpdate: bot.lastUpdate,
            implementations: bot.implementations || [],
            isOnline: bot.isOnline || false,
            lastOnlineCheck: bot.lastOnlineCheck,
            qrCodeStartTime: bot.qrCodeStartTime
        }));
    }

    setClientConnected(connected) {
        this.isClientConnected = connected;
    }

    // 辅助方法
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 清理资源
    async cleanup() {
        console.log('清理机器人管理器...');
        
        // 清理定时器
        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
        }
        if (this.qrCodeCheckInterval) {
            clearInterval(this.qrCodeCheckInterval);
        }
        
        // 清理所有扫码超时检测
        for (const [botId] of this.qrTimeouts) {
            this.clearQrCodeTimeout(botId);
        }
        
        // 清理进程管理器
        if (this.processManager) {
            await this.processManager.cleanup();
        }
        
        console.log('机器人管理器清理完成');
    }
}

module.exports = BotManager;
