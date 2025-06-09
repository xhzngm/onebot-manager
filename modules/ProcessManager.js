const fs = require('fs-extra');
const path = require('path');
const { spawn, exec } = require('child_process');
const os = require('os');
const EventEmitter = require('events');

class ProcessManager extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.processes = new Map(); // botId -> { pid, startTime, restartCount, configPath, executablePath, apiEndpoint, childProcess }
        this.pidFile = path.join(this.config.logDir, 'processes.json');
        this.isWindows = os.platform() === 'win32';
        this.statusCheckers = new Map(); // 状态检查器
        this.botLogs = new Map(); // botId -> logs array - 分离存储
        this.maxLogLines = 1000; // 每个机器人最大保存的日志行数
        
        // 确保日志目录存在
        this.ensureLogDir();
    }

    // 确保日志目录存在
    async ensureLogDir() {
        try {
            await fs.ensureDir(this.config.logDir);
            console.log(`日志目录已确保存在: ${this.config.logDir}`);
        } catch (error) {
            console.error('创建日志目录失败:', error);
        }
    }

    // 初始化机器人日志存储
    initBotLogs(botId) {
        if (!this.botLogs.has(botId)) {
            this.botLogs.set(botId, []);
            console.log(`初始化机器人 ${botId} 的日志存储`);
        }
    }

    // 日志过滤规则
    shouldFilterLog(message) {
        const filterPatterns = [
            /ValidatingAccessTokenFail/,
            /ForwardWSService.*Connect\(/,
            /ForwardWSService.*NotWebSocketRequest/,
            /info: Lagrange\.OneBot\.Core\.Network\.Service\.ForwardWSService\[11\]/,
            /warn: Lagrange\.OneBot\.Core\.Network\.Service\.ForwardWSService\[99[67]\]/,
            /\[\d+\] info: Lagrange\.OneBot\.Core\.Network\.Service\.ForwardWSService\[11\]/,
            /\[\d+\] warn: Lagrange\.OneBot\.Core\.Network\.Service\.ForwardWSService\[997\]/,
            /\[\d+\] warn: Lagrange\.OneBot\.Core\.Network\.Service\.ForwardWSService\[996\]/,
            /Connect\([a-f0-9\-]+\)/,
            /ValidatingAccessTokenFail\([a-f0-9\-]+\)/,
            /NotWebSocketRequest\([a-f0-9\-]+\)/
        ];
        
        return filterPatterns.some(pattern => pattern.test(message));
    }

    // 添加日志条目 - 分离存储每个机器人的日志，增加过滤功能
    addLogEntry(botId, message, type = 'info') {
        const messageStr = message.toString().trim();
        
        // 过滤掉指定的日志
        if (this.shouldFilterLog(messageStr)) {
            return;
        }
        
        // 确保机器人日志存储已初始化
        this.initBotLogs(botId);
        
        const logs = this.botLogs.get(botId);
        const timestamp = Date.now();
        const timeStr = new Date(timestamp).toLocaleString('zh-CN');
        
        const logEntry = {
            timestamp,
            time: timeStr,
            type,
            message: messageStr
        };
        
        logs.push(logEntry);
        
        // 限制日志数量，保留历史日志
        if (logs.length > this.maxLogLines) {
            logs.splice(0, logs.length - this.maxLogLines);
        }
        
        // 异步保存日志到文件
        this.saveLogToFile(botId, logEntry);
        
        // 发送实时日志事件
        this.emit('log', {
            botId,
            ...logEntry
        });
        
        console.log(`[${botId}] ${logEntry.message}`);
    }

    // 保存日志到文件
    async saveLogToFile(botId, logEntry) {
        try {
            const logDir = path.join(this.config.logDir, 'bots');
            await fs.ensureDir(logDir);
            
            const logFile = path.join(logDir, `${botId}.log`);
            const logLine = `[${logEntry.time}] [${logEntry.type.toUpperCase()}] ${logEntry.message}\n`;
            
            await fs.appendFile(logFile, logLine);
        } catch (error) {
            console.error(`保存机器人 ${botId} 日志失败:`, error);
        }
    }

    // 从文件加载历史日志
    async loadLogFromFile(botId) {
        try {
            const logFile = path.join(this.config.logDir, 'bots', `${botId}.log`);
            
            if (await fs.pathExists(logFile)) {
                const content = await fs.readFile(logFile, 'utf8');
                const lines = content.split('\n').filter(line => line.trim());
                
                const logs = [];
                lines.forEach(line => {
                    const match = line.match(/^\[(.*?)\] \[(.*?)\] (.*)$/);
                    if (match) {
                        logs.push({
                            timestamp: new Date(match[1]).getTime(),
                            time: match[1],
                            type: match[2].toLowerCase(),
                            message: match[3]
                        });
                    }
                });
                
                // 只保留最新的日志
                if (logs.length > this.maxLogLines) {
                    logs.splice(0, logs.length - this.maxLogLines);
                }
                
                this.botLogs.set(botId, logs);
                console.log(`从文件加载机器人 ${botId} 的 ${logs.length} 条历史日志`);
                return logs;
            }
        } catch (error) {
            console.error(`加载机器人 ${botId} 历史日志失败:`, error);
        }
        
        return [];
    }

    // 获取机器人日志 - 包含历史日志
    async getBotLogs(botId) {
        // 如果内存中没有日志，从文件加载
        if (!this.botLogs.has(botId)) {
            await this.loadLogFromFile(botId);
        }
        
        return this.botLogs.get(botId) || [];
    }

    // 清空机器人日志
    async clearBotLogs(botId) {
        // 清空内存中的日志
        if (this.botLogs.has(botId)) {
            this.botLogs.set(botId, []);
        }
        
        // 删除日志文件
        try {
            const logFile = path.join(this.config.logDir, 'bots', `${botId}.log`);
            if (await fs.pathExists(logFile)) {
                await fs.remove(logFile);
                console.log(`清空机器人 ${botId} 的日志文件`);
            }
        } catch (error) {
            console.error(`清空机器人 ${botId} 日志文件失败:`, error);
        }
    }

    // 获取机器人工作目录
    getBotWorkingDir(botId) {
        return path.resolve(this.config.botRootDir, botId);
    }

    // 查找机器人配置中的API端点
    findApiEndpoint(configPath, botId) {
        try {
            if (!fs.existsSync(configPath)) {
                this.addLogEntry(botId, `配置文件不存在: ${configPath}`, 'error');
                return null;
            }

            const config = fs.readJsonSync(configPath);
            
            if (!config.Implementations) {
                this.addLogEntry(botId, '没有找到API接口配置', 'warning');
                return null;
            }

            // 查找现有的ForwardWebSocket或Http配置作为API端点
            for (const impl of config.Implementations) {
                if (impl.Type === 'ForwardWebSocket' || impl.Type === 'Http') {
                    const apiEndpoint = {
                        host: impl.Host === '0.0.0.0' ? '127.0.0.1' : impl.Host,
                        port: impl.Port,
                        accessToken: impl.AccessToken || ''
                    };
                    this.addLogEntry(botId, `找到${impl.Type}配置，端口: ${apiEndpoint.port}`, 'info');
                    return apiEndpoint;
                }
            }

            this.addLogEntry(botId, '没有找到合适的API接口配置', 'warning');
            return null;
        } catch (error) {
            this.addLogEntry(botId, `解析配置失败: ${error.message}`, 'error');
            return null;
        }
    }

    // 端口连接检测 - 修复状态检测
    async checkPortConnection(apiEndpoint, timeout = 5000) {
        return new Promise((resolve) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort();
                resolve({ online: false, error: 'timeout', message: '连接超时' });
            }, timeout);

            // 使用简单的HTTP请求检测端口
            fetch(`http://${apiEndpoint.host}:${apiEndpoint.port}/`, {
                method: 'GET',
                signal: controller.signal,
                headers: {
                    'User-Agent': 'OneBot-Manager/1.0'
                }
            })
            .then((response) => {
                clearTimeout(timeoutId);
                // OneBot协议的端口通常返回400-500之间的状态码
                const isOnline = response.status >= 200 && response.status < 600;
                resolve({ 
                    online: isOnline, 
                    status: response.status,
                    statusText: response.statusText,
                    message: `HTTP ${response.status} ${response.statusText}`
                });
            })
            .catch((error) => {
                clearTimeout(timeoutId);
                if (error.name === 'AbortError') {
                    resolve({ online: false, error: 'timeout', message: '连接超时' });
                } else {
                    resolve({ online: false, error: 'connection_failed', message: `连接失败: ${error.message}` });
                }
            });
        });
    }

    // 启动状态检查器 - 优化扫码期间检测和登录后检测间隔
    startStatusChecker(botId) {
        this.stopStatusChecker(botId);
        
        const processInfo = this.processes.get(botId);
        if (!processInfo || !processInfo.apiEndpoint) {
            this.addLogEntry(botId, '没有API端点，无法启动状态检查', 'warning');
            return;
        }

        this.addLogEntry(botId, `启动状态检查器，检测端口 ${processInfo.apiEndpoint.port}`, 'info');

        let checkInterval = 3000; // 默认3秒检查一次
        let consecutiveFailures = 0;
        let isLoggedIn = false;

        const performCheck = async () => {
            const now = Date.now();
            const timeSinceStart = now - (processInfo.startTime || 0);

            if (processInfo.status === 'starting' || processInfo.status === 'running') {
                const statusResult = await this.checkPortConnection(processInfo.apiEndpoint, 3000);
                processInfo.lastStatusCheck = now;
                
                if (statusResult.online) {
                    if (processInfo.status !== 'running') {
                        processInfo.status = 'running';
                        this.addLogEntry(botId, `端口响应正常: ${statusResult.message}`, 'success');
                    }
                    
                    // 检测是否已登录
                    if (!isLoggedIn) {
                        isLoggedIn = true;
                        this.addLogEntry(botId, '机器人已上线，调整检测间隔为1分钟', 'info');
                        
                        // 停止当前检查器，启动新的1分钟间隔检查器
                        this.stopStatusChecker(botId);
                        this.startLoggedInStatusChecker(botId);
                        return;
                    }
                    
                    consecutiveFailures = 0;
                } else {
                    consecutiveFailures++;
                    
                    // 扫码期间持续检测，不轻易重启
                    const maxFailures = timeSinceStart < 300000 ? 10 : 3; // 启动5分钟内允许更多失败次数
                    
                    if (consecutiveFailures >= maxFailures) {
                        if (processInfo.status === 'running' || processInfo.status === 'starting') {
                            processInfo.status = 'stopped';
                            processInfo.pid = null;
                            this.addLogEntry(botId, `端口无响应 (连续${consecutiveFailures}次): ${statusResult.message}`, 'error');
                            this.stopStatusChecker(botId);
                        }
                    } else {
                        this.addLogEntry(botId, `端口检测失败 (${consecutiveFailures}/${maxFailures}): ${statusResult.message}`, 'warning');
                    }
                }
            }
        };

        // 首次检查延迟5秒
        setTimeout(performCheck, 5000);
        const checker = setInterval(performCheck, checkInterval);
        this.statusCheckers.set(botId, checker);
    }

    // 登录后的状态检查器 - 1分钟检测一次
    startLoggedInStatusChecker(botId) {
        this.stopStatusChecker(botId);
        
        const processInfo = this.processes.get(botId);
        if (!processInfo || !processInfo.apiEndpoint) {
            return;
        }

        this.addLogEntry(botId, '启动登录后状态检查器，每分钟检测一次', 'info');

        const checkInterval = 60000; // 1分钟检查一次
        let consecutiveFailures = 0;

        const performCheck = async () => {
            if (processInfo.status === 'running') {
                const statusResult = await this.checkPortConnection(processInfo.apiEndpoint, 5000);
                processInfo.lastStatusCheck = Date.now();
                
                if (statusResult.online) {
                    consecutiveFailures = 0;
                } else {
                    consecutiveFailures++;
                    
                    if (consecutiveFailures >= 3) {
                        processInfo.status = 'stopped';
                        processInfo.pid = null;
                        this.addLogEntry(botId, `机器人离线 (连续${consecutiveFailures}次检测失败): ${statusResult.message}`, 'error');
                        this.stopStatusChecker(botId);
                    } else {
                        this.addLogEntry(botId, `状态检测失败 (${consecutiveFailures}/3): ${statusResult.message}`, 'warning');
                    }
                }
            }
        };

        const checker = setInterval(performCheck, checkInterval);
        this.statusCheckers.set(botId, checker);
    }

    // 停止状态检查器
    stopStatusChecker(botId) {
        const checker = this.statusCheckers.get(botId);
        if (checker) {
            clearInterval(checker);
            this.statusCheckers.delete(botId);
            this.addLogEntry(botId, '停止状态检查器', 'info');
        }
    }

    // 设置进程日志监听
    setupProcessLogging(childProcess, botId) {
        // 监听标准输出
        if (childProcess.stdout) {
            childProcess.stdout.on('data', (data) => {
                const message = data.toString();
                const lines = message.split('\n').filter(line => line.trim());
                lines.forEach(line => {
                    this.addLogEntry(botId, line, 'info');
                });
            });
        }

        // 监听错误输出
        if (childProcess.stderr) {
            childProcess.stderr.on('data', (data) => {
                const message = data.toString();
                const lines = message.split('\n').filter(line => line.trim());
                lines.forEach(line => {
                    this.addLogEntry(botId, line, 'error');
                });
            });
        }
    }

    // 启动机器人进程
    async startBot(botId, configPath, executablePath) {
        try {
            await this.stopSpecificBot(botId);
            await this.sleep(1000);

            // 初始化日志存储
            this.initBotLogs(botId);
            
            this.addLogEntry(botId, '开始启动机器人进程', 'info');
            this.addLogEntry(botId, `可执行文件: ${executablePath}`, 'info');
            this.addLogEntry(botId, `配置文件: ${configPath}`, 'info');

            // 处理 Docker 环境和相对路径
            let fullExePath;
            if (path.isAbsolute(executablePath)) {
                fullExePath = executablePath;
            } else {
                // 在 Docker 环境中，如果是相对路径，应该相对于工作目录
                fullExePath = path.resolve(process.cwd(), executablePath);
            }
            
            const fullConfigPath = path.isAbsolute(configPath) ? configPath : path.resolve(process.cwd(), configPath);
            const botWorkingDir = this.getBotWorkingDir(botId);
            
            this.addLogEntry(botId, `当前工作目录: ${process.cwd()}`, 'info');
            this.addLogEntry(botId, `机器人工作目录: ${botWorkingDir}`, 'info');
            this.addLogEntry(botId, `解析后的可执行文件路径: ${fullExePath}`, 'info');

            await fs.ensureDir(botWorkingDir);

            // 检查多个可能的路径
            const possiblePaths = [
                fullExePath,
                path.join(process.cwd(), 'Lagrange.OneBot'),
                path.join(botWorkingDir, 'Lagrange.OneBot'),
                './Lagrange.OneBot'
            ];

            let validExePath = null;
            for (const testPath of possiblePaths) {
                this.addLogEntry(botId, `检查路径: ${testPath}`, 'debug');
                if (await fs.pathExists(testPath)) {
                    validExePath = testPath;
                    this.addLogEntry(botId, `找到可执行文件: ${testPath}`, 'success');
                    break;
                }
            }

            if (!validExePath) {
                // 列出当前目录文件帮助调试
                try {
                    const files = await fs.readdir(process.cwd());
                    this.addLogEntry(botId, `当前目录文件: ${files.join(', ')}`, 'debug');
                } catch (e) {
                    this.addLogEntry(botId, `无法列出目录文件: ${e.message}`, 'error');
                }
                throw new Error(`可执行文件不存在: ${fullExePath}`);
            }
            
            fullExePath = validExePath;
            if (!await fs.pathExists(fullConfigPath)) {
                throw new Error(`配置文件不存在: ${fullConfigPath}`);
            }

            const apiEndpoint = this.findApiEndpoint(fullConfigPath, botId);

            this.addLogEntry(botId, '启动子进程...', 'info');
            
            const childProcess = spawn(fullExePath, {
                detached: false,
                stdio: ['ignore', 'pipe', 'pipe'], // 捕获stdout和stderr
                cwd: botWorkingDir,
                windowsHide: true
            });

            if (!childProcess.pid) {
                throw new Error('无法获取进程PID');
            }

            // 设置进程日志监听
            this.setupProcessLogging(childProcess, botId);

            const processInfo = {
                pid: childProcess.pid,
                startTime: Date.now(),
                restartCount: 0,
                configPath: fullConfigPath,
                executablePath: fullExePath,
                workingDir: botWorkingDir,
                childProcess: childProcess,
                apiEndpoint: apiEndpoint,
                status: apiEndpoint ? 'starting' : 'running',
                lastStatusCheck: null
            };

            this.processes.set(botId, processInfo);
            await this.savePidToFile();

            this.addLogEntry(botId, `进程启动成功，PID: ${childProcess.pid}`, 'success');

            if (apiEndpoint) {
                this.addLogEntry(botId, `将检测端口 ${apiEndpoint.port} 状态`, 'info');
                setTimeout(() => {
                    this.startStatusChecker(botId);
                }, 2000);
            } else {
                this.addLogEntry(botId, '没有端口配置，无法自动检测状态', 'warning');
            }

            // 设置进程事件监听
            childProcess.on('exit', (code) => {
                this.addLogEntry(botId, `进程退出，代码: ${code}`, code === 0 ? 'info' : 'error');
                this.processes.delete(botId);
                this.savePidToFile();
                this.stopStatusChecker(botId);
            });

            childProcess.on('error', (error) => {
                this.addLogEntry(botId, `进程错误: ${error.message}`, 'error');
                this.stopStatusChecker(botId);
            });

            return {
                success: true,
                pid: childProcess.pid,
                apiEndpoint: apiEndpoint,
                message: `机器人启动成功，PID: ${childProcess.pid}${apiEndpoint ? `，将检测端口: ${apiEndpoint.port}` : ''}`
            };

        } catch (error) {
            this.addLogEntry(botId, `启动失败: ${error.message}`, 'error');
            return {
                success: false,
                error: error.message
            };
        }
    }

    // 停止指定机器人
    async stopSpecificBot(botId) {
        try {
            this.addLogEntry(botId, '开始停止机器人进程', 'info');
            
            const processInfo = this.processes.get(botId);
            this.stopStatusChecker(botId);
            
            if (processInfo && processInfo.childProcess) {
                this.addLogEntry(botId, `终止子进程 PID: ${processInfo.pid}`, 'info');
                try {
                    processInfo.childProcess.kill('SIGTERM');
                    setTimeout(() => {
                        if (processInfo.childProcess && !processInfo.childProcess.killed) {
                            processInfo.childProcess.kill('SIGKILL');
                            this.addLogEntry(botId, '强制终止进程', 'warning');
                        }
                    }, 3000);
                } catch (error) {
                    this.addLogEntry(botId, `终止子进程失败: ${error.message}`, 'error');
                }
            }
            
            if (processInfo && processInfo.pid) {
                this.addLogEntry(botId, `备用方法终止进程 PID: ${processInfo.pid}`, 'info');
                await this.killProcessByPid(processInfo.pid);
            }
            
            const savedProcesses = await this.loadPidFile();
            if (savedProcesses[botId] && savedProcesses[botId].pid) {
                this.addLogEntry(botId, `清理保存的进程 PID: ${savedProcesses[botId].pid}`, 'info');
                await this.killProcessByPid(savedProcesses[botId].pid);
            }
            
            this.processes.delete(botId);
            await this.savePidToFile();
            
            this.addLogEntry(botId, '机器人停止完成', 'success');
            return { success: true, message: '机器人已停止' };

        } catch (error) {
            this.addLogEntry(botId, `停止失败: ${error.message}`, 'error');
            this.processes.delete(botId);
            await this.savePidToFile();
            return { success: false, error: error.message };
        }
    }

    // 停止机器人进程
    async stopBot(botId) {
        return await this.stopSpecificBot(botId);
    }

    // 强制停止机器人进程
    async forceStopBot(botId) {
        return await this.stopSpecificBot(botId);
    }

    // 终止进程
    async killProcessByPid(pid) {
        if (!pid) return;

        try {
            if (this.isWindows) {
                const isRunning = await this.checkProcessRunning(pid);
                if (!isRunning) {
                    console.log(`进程 PID ${pid} 已经不存在`);
                    return;
                }
                
                try {
                    await this.executeCommand(`taskkill /F /T /PID ${pid}`);
                    console.log(`进程树终止成功 PID: ${pid}`);
                    await this.sleep(2000);
                    
                    const isStillRunning = await this.checkProcessRunning(pid);
                    if (!isStillRunning) {
                        console.log(`确认进程 PID ${pid} 已成功终止`);
                    } else {
                        console.warn(`进程 PID ${pid} 可能仍在运行`);
                        try {
                            await this.executeCommand(`wmic process where processid=${pid} delete`);
                            console.log(`WMIC强制终止进程 PID: ${pid}`);
                            await this.sleep(2000);
                        } catch (wmicError) {
                            console.log(`WMIC方法失败: ${wmicError.message}`);
                        }
                    }
                } catch (error) {
                    console.log(`进程树终止失败: ${error.message}`);
                }
            } else {
                await this.executeCommand(`kill -9 ${pid}`);
                console.log(`终止进程 PID: ${pid}`);
                await this.sleep(1000);
            }
        } catch (error) {
            console.log(`终止进程 ${pid} 失败: ${error.message}`);
        }
    }

    // 重启机器人
    async restartBot(botId, configPath, executablePath) {
        try {
            this.addLogEntry(botId, '开始重启机器人', 'info');
            await this.stopSpecificBot(botId);
            await this.sleep(3000);
            return await this.startBot(botId, configPath, executablePath);
        } catch (error) {
            this.addLogEntry(botId, `重启失败: ${error.message}`, 'error');
            return { success: false, error: error.message };
        }
    }

    // 获取进程状态 - 改进状态获取
    async getProcessStatus(botId) {
        const processInfo = this.processes.get(botId);
        
        if (!processInfo) {
            return { status: 'stopped', pid: null, isOnline: false };
        }

        const { pid, startTime, restartCount, apiEndpoint } = processInfo;
        
        let isOnline = false;
        if (apiEndpoint) {
            const statusResult = await this.checkPortConnection(apiEndpoint, 2000);
            isOnline = statusResult.online;
            
            if (statusResult.online) {
                processInfo.status = 'running';
                processInfo.lastStatusCheck = Date.now();
            } else {
                const isRunning = await this.checkProcessRunning(pid);
                if (!isRunning) {
                    this.processes.delete(botId);
                    await this.savePidToFile();
                    this.stopStatusChecker(botId);
                    return { status: 'stopped', pid: null, isOnline: false };
                } else {
                    processInfo.status = 'starting';
                }
            }
        } else {
            const isRunning = await this.checkProcessRunning(pid);
            if (!isRunning) {
                this.processes.delete(botId);
                await this.savePidToFile();
                return { status: 'stopped', pid: null, isOnline: false };
            }
        }

        return {
            status: processInfo.status,
            pid: pid,
            startTime: startTime,
            uptime: Date.now() - startTime,
            restartCount: restartCount || 0,
            apiEndpoint: apiEndpoint,
            lastStatusCheck: processInfo.lastStatusCheck,
            isOnline: isOnline
        };
    }

    // 检查进程是否运行
    async checkProcessRunning(pid) {
        if (!pid) return false;
        
        try {
            if (this.isWindows) {
                const output = await this.executeCommand(`tasklist /FI "PID eq ${pid}" /FO CSV`);
                return output.includes(pid.toString());
            } else {
                const output = await this.executeCommand(`ps -p ${pid}`);
                return output.includes(pid.toString());
            }
        } catch (error) {
            return false;
        }
    }

    // 清理死进程
    async cleanupDeadProcesses() {
        let cleanedCount = 0;
        
        for (const [botId, processInfo] of this.processes) {
            if (processInfo.pid) {
                const isRunning = await this.checkProcessRunning(processInfo.pid);
                if (!isRunning) {
                    this.addLogEntry(botId, `检测到死进程 PID: ${processInfo.pid}，清理中...`, 'warning');
                    this.processes.delete(botId);
                    this.stopStatusChecker(botId);
                    cleanedCount++;
                }
            }
        }
        
        if (cleanedCount > 0) {
            await this.savePidToFile();
        }
        
        return cleanedCount;
    }

    // 清理所有僵尸进程
    async cleanupAllProcesses() {
        try {
            console.log('清理所有机器人进程...');
            
            for (const [botId, processInfo] of this.processes) {
                this.stopStatusChecker(botId);
                if (processInfo.childProcess) {
                    console.log(`清理机器人 ${botId} 子进程 PID: ${processInfo.pid}`);
                    try {
                        processInfo.childProcess.kill('SIGKILL');
                    } catch (error) {
                        console.log(`清理子进程失败: ${error.message}`);
                    }
                }
                if (processInfo.pid) {
                    await this.killProcessByPid(processInfo.pid);
                }
            }
            
            this.processes.clear();
            await this.savePidToFile();
            console.log('进程清理完成');
        } catch (error) {
            console.error('清理进程失败:', error.message);
        }
    }

    // 执行系统命令
    async executeCommand(command) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('命令执行超时'));
            }, 15000);

            exec(command, { encoding: 'utf8' }, (error, stdout, stderr) => {
                clearTimeout(timeout);
                if (error) {
                    reject(error);
                } else {
                    resolve(stdout);
                }
            });
        });
    }

    // 保存PID到文件
    async savePidToFile() {
        try {
            await fs.ensureDir(path.dirname(this.pidFile));
            
            const processData = {};
            for (const [botId, processInfo] of this.processes) {
                processData[botId] = {
                    pid: processInfo.pid,
                    startTime: processInfo.startTime,
                    configPath: processInfo.configPath,
                    executablePath: processInfo.executablePath,
                    workingDir: processInfo.workingDir,
                    apiEndpoint: processInfo.apiEndpoint,
                    status: processInfo.status
                };
            }
            
            await fs.writeJson(this.pidFile, processData, { spaces: 2 });
        } catch (error) {
            console.error('保存PID文件失败:', error.message);
        }
    }

    // 加载PID文件
    async loadPidFile() {
        try {
            if (await fs.pathExists(this.pidFile)) {
                const content = await fs.readFile(this.pidFile, 'utf8');
                
                if (!content.trim()) {
                    console.log('PID文件为空，重新创建');
                    await fs.writeJson(this.pidFile, {}, { spaces: 2 });
                    return {};
                }
                
                return JSON.parse(content);
            }
        } catch (error) {
            console.error('读取PID文件失败:', error.message);
            try {
                await fs.remove(this.pidFile);
                await fs.writeJson(this.pidFile, {}, { spaces: 2 });
                console.log('已重新创建PID文件');
            } catch (deleteError) {
                console.error('重新创建PID文件失败:', deleteError.message);
            }
        }
        return {};
    }

    // 辅助方法：睡眠
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 获取所有进程状态
    async getAllProcessStatus() {
        const statuses = {};
        
        for (const [botId] of this.processes) {
            statuses[botId] = await this.getProcessStatus(botId);
        }
        
        return statuses;
    }

    // 清理方法
    async cleanup() {
        for (const [botId] of this.statusCheckers) {
            this.stopStatusChecker(botId);
        }
        
        await this.cleanupAllProcesses();
    }
}

module.exports = ProcessManager;
