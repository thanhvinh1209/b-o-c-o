// ==========================================
// CẤU HÌNH TELEGRAM CỐ ĐỊNH (FIXED CONFIG)
// ==========================================
const FIXED_TELEGRAM_BOT_TOKEN = '8929036689:AAH9JVQ5Kn2HTbZLjQEiobwnOxUJdFP30XI';
const FIXED_TELEGRAM_CHAT_ID = '6750367217';

// Đọc/Ghi URL Python Backend linh hoạt (mặc định localhost hoặc ngrok URL)
const inputBackendUrl = document.getElementById('input-backend-url');
const savedBackendUrl = localStorage.getItem('iot_guard_backend_url');

if (savedBackendUrl && inputBackendUrl) {
    inputBackendUrl.value = savedBackendUrl;
}

// Gửi thông báo Telegram tự động cố định từ Frontend JavaScript
async function sendTelegramNotification(message) {
    if (!FIXED_TELEGRAM_BOT_TOKEN || !FIXED_TELEGRAM_CHAT_ID) return false;

    try {
        const url = `https://api.telegram.org/bot${FIXED_TELEGRAM_BOT_TOKEN}/sendMessage`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: FIXED_TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'HTML'
            })
        });
        return res.ok;
    } catch (e) {
        console.error('Lỗi gửi Telegram:', e);
        return false;
    }
}

function getBackendUrl() {
    if (!inputBackendUrl) return "http://127.0.0.1:5000";
    let url = inputBackendUrl.value.trim();
    if (!url) url = "http://127.0.0.1:5000";
    // Xóa dấu / ở cuối nếu có
    url = url.replace(/\/+$/, '');
    localStorage.setItem('iot_guard_backend_url', url);
    return url;
}

if (inputBackendUrl) {
    inputBackendUrl.addEventListener('change', () => {
        const url = getBackendUrl();
        addLog(`[CONFIG] Đã cập nhật URL Backend Server: <code>${url}</code>`, "success-log");
    });
}


// ==========================================
// ĐỊNH NGHĨA TRẠNG THÁI HỆ THỐNG
// ==========================================
let systemState = {
    isScanning: false,
    hasScanned: false,
    activeDevices: [], // Danh sách các thiết bị đang online trong giao diện
    unauthorizedDetected: false,
    isRoguePresent: false,
    blockedDevices: new Set()
};

let demoRogueActive = false;
let IS_DEMO_MODE = false;

// ==========================================
// KHỞI TẠO DOM ELEMENTS
// ==========================================
const btnScan = document.getElementById('btn-scan');
const btnReset = document.getElementById('btn-reset');
const btnClearLogs = document.getElementById('btn-clear-logs');
const terminalLogs = document.getElementById('terminal-logs');

const statTotal = document.getElementById('stat-total');
const statAuthorized = document.getElementById('stat-authorized');
const statUnauthorized = document.getElementById('stat-unauthorized');

const scanBadge = document.getElementById('scan-badge');
const systemStatusContainer = document.getElementById('system-status-container');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

const deviceTableBody = document.getElementById('device-table-body');
const networkCanvas = document.getElementById('network-canvas');
const nodesContainer = document.getElementById('nodes-container');
const connectionsContainer = document.getElementById('connections-container');

// Modal
const alertModal = document.getElementById('alert-modal');
const btnModalBlock = document.getElementById('btn-modal-block');
const btnModalClose = document.getElementById('btn-modal-close');
const modalIp = document.getElementById('modal-ip');
const modalMac = document.getElementById('modal-mac');
const modalVendor = document.getElementById('modal-vendor');

// ==========================================
// CÁC HÀM TIỆN ÍCH & GIAO DIỆN
// ==========================================

// Âm thanh cảnh báo bằng Web Audio API
function playAlarmSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Tiếng beep 1 (Tần số cao)
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc1.type = 'sawtooth';
        osc1.frequency.setValueAtTime(880, audioCtx.currentTime); // Note A5
        gain1.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
        osc1.start(audioCtx.currentTime);
        osc1.stop(audioCtx.currentTime + 0.5);

        // Tiếng beep 2 (Cảnh báo kéo dài sau đó)
        setTimeout(() => {
            const osc2 = audioCtx.createOscillator();
            const gain2 = audioCtx.createGain();
            osc2.connect(gain2);
            gain2.connect(audioCtx.destination);
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(660, audioCtx.currentTime); // Note E5
            gain2.gain.setValueAtTime(0.2, audioCtx.currentTime);
            gain2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.8);
            osc2.start(audioCtx.currentTime);
            osc2.stop(audioCtx.currentTime + 0.8);
        }, 150);
    } catch (e) {
        console.warn("Không thể phát âm thanh: Trình duyệt chưa cho phép tương tác âm thanh.", e);
    }
}

// Thêm dòng log vào Terminal
function addLog(message, type = 'system-log') {
    const timestamp = new Date().toLocaleTimeString();
    const logLine = document.createElement('div');
    logLine.className = `log-line ${type}`;
    logLine.innerHTML = `<span style="color: #6b7280; margin-right: 8px;">[${timestamp}]</span>${message}`;
    terminalLogs.appendChild(logLine);
    terminalLogs.scrollTop = terminalLogs.scrollHeight;
}

// Xóa Terminal Logs
btnClearLogs.addEventListener('click', () => {
    terminalLogs.innerHTML = '<div class="log-line system-log">[SYSTEM] Nhật ký đã được dọn sạch.</div>';
});

// ==========================================
// VẼ BẢN ĐỒ MẠNG DỰA TRÊN ANGLE & RADIUS
// ==========================================
let svgConnections = null;

// Tính toán vị trí góc và bán kính phân lớp để tránh chồng chéo khi có nhiều thiết bị
function getDevicePosition(index, totalCount) {
    let radius = 120;
    let angle = 0;
    
    if (totalCount <= 6) {
        // Chỉ có 1 vòng duy nhất
        radius = 110;
        angle = (index * 360) / totalCount;
    } else if (totalCount <= 12) {
        // Phân làm 2 vòng (Vòng trong: 4, Vòng ngoài: còn lại)
        if (index < 4) {
            radius = 70;
            angle = (index * 360) / 4;
        } else {
            radius = 120;
            angle = ((index - 4) * 360) / (totalCount - 4) + 45; // Lệch góc để so le
        }
    } else {
        // Phân làm 3 vòng (Vòng trong: 4, Vòng giữa: 6, Vòng ngoài: còn lại)
        if (index < 4) {
            radius = 65;
            angle = (index * 360) / 4;
        } else if (index < 10) {
            radius = 105;
            angle = ((index - 4) * 360) / 6 + 30;
        } else {
            radius = 145;
            angle = ((index - 10) * 360) / (totalCount - 10) + 15;
        }
    }
    return { angle, radius };
}

function initNetworkMap() {
    // Xóa hết nodes cũ
    nodesContainer.innerHTML = '';
    connectionsContainer.innerHTML = '';
    
    // Tạo thẻ SVG để vẽ đường kết nối
    svgConnections = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgConnections.setAttribute("class", "connections-svg");
    connectionsContainer.appendChild(svgConnections);

    // Vẽ router trung tâm
    const routerDiv = document.createElement('div');
    routerDiv.className = 'network-node router-node';
    routerDiv.id = 'node-router';
    routerDiv.innerHTML = `<i class="fa-solid fa-wifi"></i><span class="node-label">Gateway Router</span>`;
    nodesContainer.appendChild(routerDiv);

    // Thêm các thiết bị hiện đang hoạt động
    systemState.activeDevices.forEach(device => {
        if (device.type === 'router') return; // Bỏ qua router chính vì đã vẽ ở trên
        createDeviceNode(device);
    });

    drawConnectionLines();
}

function createDeviceNode(device) {
    const node = document.createElement('div');
    const isBlocked = systemState.blockedDevices.has(device.mac);
    
    node.className = `network-node device-node ${!device.authorized ? 'unauthorized' : ''} ${isBlocked ? 'blocked-node' : ''}`;
    node.id = `node-${device.mac.replace(/:/g, '-')}`;
    
    // Định vị trí tuyệt đối dựa trên angle và radius
    const angleRad = (device.angle * Math.PI) / 180;
    
    // Tính toán tọa độ left và top tương đối (%) so với tâm
    // Canvas có kích thước tùy biến, chúng ta đặt tâm là 50%
    const leftOffset = 50 + (device.radius / 3) * Math.cos(angleRad); // Chia 3 để thu nhỏ tỷ lệ hiển thị
    const topOffset = 50 + (device.radius / 3.2) * Math.sin(angleRad); // Chia 3.2 để tránh tràn viền dọc
    
    node.style.left = `${leftOffset}%`;
    node.style.top = `${topOffset}%`;
    
    // Icon thiết bị
    let iconClass = isBlocked ? 'fa-ban' : device.icon;
    if (device.authorized && iconClass === 'fa-user-secret') {
        iconClass = 'fa-laptop';
    }
    node.innerHTML = `<i class="fa-solid ${iconClass}"></i><span class="node-label">${device.name}</span>`;
    
    // Sự kiện click để xem chi tiết
    node.addEventListener('click', () => {
        addLog(`[UI] Đã chọn thiết bị: ${device.name} (${device.ip} - ${device.mac})`, 'system-log');
    });

    nodesContainer.appendChild(node);
}

// Vẽ đường dây kết nối giữa router và các node
function drawConnectionLines() {
    if (!svgConnections) return;
    svgConnections.innerHTML = ''; // Clear lines

    const canvasRect = networkCanvas.getBoundingClientRect();
    const routerNode = document.getElementById('node-router');
    if (!routerNode) return;
    
    const routerRect = routerNode.getBoundingClientRect();
    const rx = routerRect.left - canvasRect.left + routerRect.width / 2;
    const ry = routerRect.top - canvasRect.top + routerRect.height / 2;

    systemState.activeDevices.forEach(device => {
        if (device.type === 'router') return;
        
        const nodeEl = document.getElementById(`node-${device.mac.replace(/:/g, '-')}`);
        if (!nodeEl) return;
        
        const nodeRect = nodeEl.getBoundingClientRect();
        const nx = nodeRect.left - canvasRect.left + nodeRect.width / 2;
        const ny = nodeRect.top - canvasRect.top + nodeRect.height / 2;

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", `M ${rx} ${ry} L ${nx} ${ny}`);
        
        // Quyết định class cho line
        let lineClass = 'connection-line';
        if (systemState.isScanning) {
            lineClass += ' active';
        } else if (!device.authorized) {
            lineClass += systemState.blockedDevices.has(device.mac) ? '' : ' unauthorized';
        } else if (systemState.hasScanned) {
            lineClass += ' active'; // Giữ đường màu xanh khi đã quét xong
        }
        
        path.setAttribute("class", lineClass);
        svgConnections.appendChild(path);
    });
}

// Vẽ lại đường kết nối khi thay đổi kích thước cửa sổ
window.addEventListener('resize', () => {
    if (systemState.hasScanned || systemState.isScanning) {
        drawConnectionLines();
    }
});

// ==========================================
// CẬP NHẬT BẢNG DANH SÁCH THIẾT BỊ
// ==========================================
function updateDeviceTable() {
    const emptyRow = document.getElementById('empty-row');
    if (systemState.activeDevices.length === 0) {
        if (emptyRow) emptyRow.style.display = 'table-row';
        deviceTableBody.innerHTML = `
            <tr id="empty-row">
                <td colspan="6" class="text-center text-muted">Chưa có dữ liệu mạng. Vui lòng bấm "Bắt đầu Quét".</td>
            </tr>`;
        return;
    }

    deviceTableBody.innerHTML = '';
    
    systemState.activeDevices.forEach(device => {
        const tr = document.createElement('tr');
        const isBlocked = systemState.blockedDevices.has(device.mac);
        
        // Trạng thái badge
        let statusBadge = '';
        if (isBlocked) {
            statusBadge = '<span class="status-pill blocked"><i class="fa-solid fa-ban"></i> Đã cô lập</span>';
        } else if (device.authorized) {
            statusBadge = '<span class="status-pill authorized"><i class="fa-solid fa-circle-check"></i> Hợp lệ</span>';
        } else {
            statusBadge = '<span class="status-pill unauthorized"><i class="fa-solid fa-circle-exclamation"></i> Trái phép</span>';
        }

        // Action buttons
        let actionBtn = '';
        if (device.type !== 'router') {
            if (device.authorized) {
                actionBtn = `<button class="btn-action btn-unauthorize" onclick="unauthorizeDevice('${device.mac}')"><i class="fa-solid fa-user-minus"></i> Hủy cấp phép</button>`;
            } else {
                const escapedName = (device.name || '').replace(/'/g, "\\'");
                const authBtn = `<button class="btn-action btn-authorize" onclick="authorizeDevice('${device.mac}', '${escapedName}')"><i class="fa-solid fa-user-check"></i> Cấp phép</button>`;
                
                if (isBlocked) {
                    const unblockBtn = `<button class="btn-action btn-unblock" onclick="toggleBlockDevice('${device.mac}', false)"><i class="fa-solid fa-unlock"></i> Bỏ chặn</button>`;
                    actionBtn = authBtn + unblockBtn;
                } else {
                    const blockBtn = `<button class="btn-action" onclick="toggleBlockDevice('${device.mac}', true)"><i class="fa-solid fa-ban"></i> Cô lập</button>`;
                    actionBtn = authBtn + blockBtn;
                }
            }
        } else {
            actionBtn = `<span class="text-muted" style="font-size: 11px;">Gateway Chính</span>`;
        }

        let displayIcon = device.icon;
        if (device.authorized && displayIcon === 'fa-user-secret') {
            displayIcon = 'fa-laptop';
        }

        tr.innerHTML = `
            <td><strong>${device.ip}</strong></td>
            <td><code>${device.mac}</code></td>
            <td><i class="fa-solid ${displayIcon}"></i> ${device.name}</td>
            <td>${device.vendor}</td>
            <td>${statusBadge}</td>
            <td>${actionBtn}</td>
        `;
        deviceTableBody.appendChild(tr);
    });
}

// ==========================================
// CẬP NHẬT CÁC CHỈ SỐ THỐNG KÊ
// ==========================================
function updateStatistics() {
    const total = systemState.activeDevices.length;
    const blockedCount = systemState.blockedDevices.size;
    
    // Lọc ra các thiết bị trái phép CHƯA bị chặn
    const unauthorized = systemState.activeDevices.filter(d => !d.authorized && !systemState.blockedDevices.has(d.mac)).length;
    const authorized = systemState.activeDevices.filter(d => d.authorized).length;

    statTotal.textContent = total;
    statAuthorized.textContent = authorized;
    statUnauthorized.textContent = unauthorized + (blockedCount ? ` (+${blockedCount} chặn)` : '');

    // Cập nhật trạng thái hệ thống
    const unblockedUnauthorized = systemState.activeDevices.filter(d => !d.authorized && !systemState.blockedDevices.has(d.mac));
    
    if (unblockedUnauthorized.length > 0) {
        systemStatusContainer.className = "system-status-indicator status-red";
        statusDot.className = "pulse-dot status-red";
        statusText.textContent = "Hệ thống: XÂM NHẬP!";
        scanBadge.className = "badge danger";
        scanBadge.textContent = "Cảnh báo";
    } else if (blockedCount > 0) {
        systemStatusContainer.className = "system-status-indicator";
        statusDot.className = "pulse-dot status-green";
        statusText.textContent = "Hệ thống: Đã cô lập lạ";
        scanBadge.className = "badge";
        scanBadge.textContent = "Đã xử lý";
    } else if (systemState.hasScanned) {
        systemStatusContainer.className = "system-status-indicator";
        statusDot.className = "pulse-dot status-green";
        statusText.textContent = "Hệ thống: An toàn";
        scanBadge.className = "badge";
        scanBadge.textContent = "An Toàn";
    } else {
        systemStatusContainer.className = "system-status-indicator";
        statusDot.className = "pulse-dot status-green";
        statusText.textContent = "Hệ thống: Chờ lệnh";
        scanBadge.className = "badge";
        scanBadge.textContent = "Sẵn sàng";
    }
}

// ==========================================
// TÍNH NĂNG CHẶN / CÔ LẬP THIẾT BỊ
// ==========================================
window.toggleBlockDevice = function(mac, shouldBlock) {
    const device = systemState.activeDevices.find(d => d.mac === mac);
    if (!device) return;

    if (shouldBlock) {
        systemState.blockedDevices.add(mac);
        addLog(`[MITIGATION] Đang kích hoạt ARP Poisoning để cô lập thiết bị ${device.ip}...`, 'warning-log');
        addLog(`[ARP SPOOF] Gửi gói tin giả mạo tới Gateway: Báo ${device.ip} đang ở địa chỉ MAC ảo (Dead MAC)`, 'scan-log');
        addLog(`[SUCCESS] Đã cắt kết nối internet thành công của thiết bị ${device.ip} (${device.mac})!`, 'success-log');
        
        sendTelegramNotification(`🚫 <b>[CÔ LẬP THIẾT BỊ]</b>\nĐã ngắt kết nối mạng của thiết bị:\n• <b>IP:</b> ${device.ip}\n• <b>MAC:</b> ${device.mac}\n• <b>Trạng thái:</b> Kích hoạt chặn ARP Spoofing.`);
    } else {
        systemState.blockedDevices.delete(mac);
        addLog(`[MITIGATION] Đã ngưng ARP Poisoning. Thiết bị ${device.ip} được khôi phục kết nối.`, 'system-log');
        
        sendTelegramNotification(`🔓 <b>[MỞ CHẶN THIẾT BỊ]</b>\nKhôi phục kết nối mạng cho thiết bị:\n• <b>IP:</b> ${device.ip}\n• <b>MAC:</b> ${device.mac}`);
    }

    // Gửi yêu cầu chặn/bỏ chặn lên Python Backend
    const action = shouldBlock ? 'block' : 'unblock';
    fetch(`${getBackendUrl()}/${action}?mac=${mac}&ip=${device.ip}`)
        .then(res => res.json())
        .then(data => {
            addLog(`[PYTHON BACKEND] Đã đồng bộ trạng thái ${action} của ${device.ip} lên Server.`, 'success-log');
        })
        .catch(err => {
            // Chạy ngầm lỗi, không ảnh hưởng đến UI
        });

    // Vẽ lại bản đồ và cập nhật UI
    initNetworkMap();
    updateDeviceTable();
    updateStatistics();
    
    // Nếu đóng modal cảnh báo sau khi chặn
    alertModal.classList.remove('active');
};

// ==========================================
// TÍNH NĂNG CẤP PHÉP / HỦY CẤP PHÉP THIẾT BỊ (WHITELIST)
// ==========================================
window.authorizeDevice = function(mac, defaultName) {
    const device = systemState.activeDevices.find(d => d.mac === mac);
    const initialName = defaultName || (device ? device.name : 'Thiết bị hợp lệ');
    
    const customName = prompt(`CẤP PHÉP THIẾT BỊ (${mac})\nNhập tên gợi nhớ cho thiết bị này để đưa vào Whitelist:`, initialName);
    if (!customName || !customName.trim()) return;
    
    const deviceName = customName.trim();
    
    // Đồng bộ lên Python Backend
    fetch(`${getBackendUrl()}/whitelist/add?mac=${encodeURIComponent(mac)}&name=${encodeURIComponent(deviceName)}`)
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                addLog(`[WHITELIST] Đã thêm địa chỉ MAC <code>${mac}</code> (${deviceName}) vào danh sách hợp lệ.`, 'success-log');
            }
        })
        .catch(() => {});
        
    // Cập nhật trạng thái cục bộ ngay lập tức
    if (device) {
        device.authorized = true;
        device.name = deviceName;
        // Đổi hình hacker thành hình máy tính lập tức trên giao diện
        if (device.icon === 'fa-user-secret') {
            device.icon = 'fa-laptop';
        }
    }
    systemState.blockedDevices.delete(mac);
    
    initNetworkMap();
    updateDeviceTable();
    updateStatistics();
    
    sendTelegramNotification(`🟢 <b>[WHITELIST - CẤP PHÉP]</b>\nThiết bị đã được phê duyệt:\n• <b>IP:</b> ${device ? device.ip : 'N/A'}\n• <b>MAC:</b> ${mac}\n• <b>Tên đặt:</b> ${deviceName}`);
    
    const btnModalAuth = document.getElementById('btn-modal-authorize');
    if (alertModal.classList.contains('active')) {
        alertModal.classList.remove('active');
    }
};

window.unauthorizeDevice = function(mac) {
    const device = systemState.activeDevices.find(d => d.mac === mac);
    if (!confirm(`Bạn có chắc muốn HỦY CẤP PHÉP cho thiết bị ${mac} (${device ? device.name : ''})?`)) return;
    
    // Gửi yêu cầu xóa khỏi Whitelist lên Python Backend
    fetch(`${getBackendUrl()}/whitelist/remove?mac=${encodeURIComponent(mac)}`)
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                addLog(`[WHITELIST] Đã xóa địa chỉ MAC <code>${mac}</code> khỏi danh sách Whitelist hợp lệ.`, 'warning-log');
            }
        })
        .catch(() => {});
        
    if (device) {
        device.authorized = false;
        // Đổi icon về lại hình thám tử/hacker (trạng thái trái phép ban đầu)
        if (device.icon === 'fa-laptop' && device.type === 'unknown') {
            device.icon = 'fa-user-secret';
        }
        device.name = "Thiết bị lạ (UNKNOWN DEVICE)";
    }
    
    initNetworkMap();
    updateDeviceTable();
    updateStatistics();
    
    sendTelegramNotification(`🔴 <b>[WHITELIST - HỦY CẤP PHÉP]</b>\nĐã thu hồi quyền truy cập của thiết bị:\n• <b>IP:</b> ${device ? device.ip : 'N/A'}\n• <b>MAC:</b> ${mac}`);
};

// ==========================================
// HÀNH VI QUÉT MẠNG THẬT (kết nối Python Backend)
// ==========================================
// ==========================================
// HÀNH VI QUÉT MẠNG THẬT (kết nối Python Backend)
// ==========================================
async function executeScan(isSilent = false) {
    if (systemState.isScanning) return;

    systemState.isScanning = true;
    
    if (!isSilent) {
        systemState.hasScanned = false;
        systemState.activeDevices = [];
        systemState.isRoguePresent = false;
        systemState.unauthorizedDetected = false;
        systemState.blockedDevices.clear();

        scanBadge.textContent = "Đang quét...";
        scanBadge.className = "badge scanning";
        initNetworkMap();
        updateDeviceTable();
        updateStatistics();
        terminalLogs.innerHTML = '';
        addLog("[SCAN] Đang kết nối tới Python Scanner Backend...", "scan-log");
        
        sendTelegramNotification(`🔍 <b>[BẮT ĐẦU QUÉT MẠNG]</b>\nHệ thống bắt đầu quét các thiết bị trong mạng LAN/Wi-Fi thực tế...`);
    } else {
        addLog("[AUTO MONITOR] Đang tự động quét kiểm tra thiết bị mới...", "scan-log");
    }

    try {
        const response = await fetch(`${getBackendUrl()}/scan`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        if (!isSilent) {
            addLog("[OK] Kết nối Backend thành công! Đang quét mạng thực tế...", "success-log");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop();

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data: ")) continue;
                try {
                    const payload = JSON.parse(trimmed.substring(6).trim());
                    if (payload.type === "log") {
                        if (!isSilent) {
                            addLog(payload.message, payload.level);
                        }
                    } else if (payload.type === "result") {
                        const data = payload.data;
                        document.getElementById('info-ip-range').textContent = data.ip_range;
                        
                        // Tự động xác định IP Router trung tâm từ dải IP thực tế (ví dụ: X.Y.Z.1)
                        let dynamicRouterIp = "192.168.1.1";
                        if (data.ip_range && data.ip_range.includes('.')) {
                            const ipPart = data.ip_range.split('/')[0];
                            const octets = ipPart.split('.');
                            if (octets.length === 4) {
                                dynamicRouterIp = `${octets[0]}.${octets[1]}.${octets[2]}.1`;
                            }
                        }

                        const nonRouterDevices = data.devices.filter(d => d.type !== 'router');
                        let routerDevice = data.devices.find(d => d.type === 'router');
                        if (routerDevice) {
                            routerDevice.authorized = true;
                        } else {
                            routerDevice = {
                                ip: dynamicRouterIp, mac: "00:11:22:33:44:55",
                                name: "Gateway Router (Trung tâm)", type: "router",
                                icon: "fa-wifi", vendor: "Cisco Systems / Mobile Hotspot", authorized: true
                            };
                        }
                        
                        const nextActiveDevices = [{ ...routerDevice, angle: 0, radius: 0 }];
                        const count = nonRouterDevices.length;
                        nonRouterDevices.forEach((dev, i) => {
                            const pos = getDevicePosition(i, count);
                            nextActiveDevices.push({
                                ...dev,
                                angle: pos.angle,
                                radius: pos.radius
                            });
                        });

                        // Tạo chuỗi danh sách thiết bị để gửi lên Telegram
                        let deviceListMessage = "";
                        nextActiveDevices.forEach((dev, idx) => {
                            const statusEmoji = dev.authorized ? "🟢" : "🔴";
                            const statusText = dev.authorized ? "Hợp lệ" : "Trái phép";
                            deviceListMessage += `${idx + 1}. ${statusEmoji} <b>${dev.ip}</b>\n   └ MAC: <code>${dev.mac}</code>\n   └ Thiết bị: ${dev.name} (${statusText})\n`;
                        });

                        // Nếu đã từng quét trước đó và có dữ liệu cũ, đối chiếu phát hiện thiết bị MỚI KẾT NỐI LẠ
                        if (systemState.hasScanned && systemState.activeDevices.length > 0) {
                            const oldMacs = new Set(systemState.activeDevices.map(d => d.mac.toLowerCase()));
                            
                            // Phát hiện thiết bị mới kết nối
                            const newlyConnected = nextActiveDevices.filter(d => !oldMacs.has(d.mac.toLowerCase()) && d.type !== 'router');
                            newlyConnected.forEach(dev => {
                                // Chỉ cảnh báo và thông báo nếu thiết bị đó là TRÁI PHÉP (kết nối lạ)
                                if (!dev.authorized) {
                                    addLog(`[CẢNH BÁO MỚI] Phát hiện thiết bị kết nối LẠ (TRÁI PHÉP): <b>${dev.name}</b> (IP: ${dev.ip}, MAC: ${dev.mac})`, "danger-log");
                                    playAlarmSound();
                                    modalIp.textContent = dev.ip;
                                    modalMac.textContent = dev.mac;
                                    modalVendor.textContent = dev.vendor;
                                    btnModalBlock.onclick = () => toggleBlockDevice(dev.mac, true);
                                    const btnModalAuthorize = document.getElementById('btn-modal-authorize');
                                    if (btnModalAuthorize) {
                                        btnModalAuthorize.onclick = () => authorizeDevice(dev.mac, dev.name);
                                    }
                                    alertModal.classList.add('active');
                                    
                                    sendTelegramNotification(`⚠️ <b>[CẢNH BÁO XÂM NHẬP MỚI]</b>\nPhát hiện thiết bị TRÁI PHÉP mới kết nối vào mạng IoT!\n\n• <b>IP:</b> ${dev.ip}\n• <b>MAC:</b> ${dev.mac}\n• <b>Nhà sản xuất:</b> ${dev.vendor}`);
                                }
                            });
                        }

                        systemState.activeDevices = nextActiveDevices;
                        systemState.isScanning = false;
                        
                        const unauthorizedDevices = data.devices.filter(d => !d.authorized);
                        if (unauthorizedDevices.length > 0) {
                            systemState.unauthorizedDetected = true;
                            // Chỉ mở modal lớn ở chế độ quét chủ động hoặc nếu thiết bị lạ vừa mới cắm vào
                            if (!isSilent) {
                                playAlarmSound();
                                const rogue = unauthorizedDevices[0];
                                modalIp.textContent = rogue.ip;
                                modalMac.textContent = rogue.mac;
                                modalVendor.textContent = rogue.vendor;
                                btnModalBlock.onclick = () => toggleBlockDevice(rogue.mac, true);
                                const btnModalAuthorize = document.getElementById('btn-modal-authorize');
                                if (btnModalAuthorize) {
                                    btnModalAuthorize.onclick = () => authorizeDevice(rogue.mac, rogue.name);
                                }
                                alertModal.classList.add('active');
                            }
                        }

                        // Chỉ gửi thông báo hoàn tất danh sách ở lần đầu tiên hoặc khi quét chủ động
                        if (!systemState.hasScanned) {
                            if (unauthorizedDevices.length > 0) {
                                const rogue = unauthorizedDevices[0];
                                sendTelegramNotification(`⚠️ <b>[CẢNH BÁO XÂM NHẬP]</b>\nPhát hiện thiết bị <b>TRÁI PHÉP</b> kết nối vào mạng IoT!\n\n<b>• Dải IP mạng:</b> ${data.ip_range}\n<b>• Tổng thiết bị phát hiện:</b> ${systemState.activeDevices.length}\n\n<b>DANH SÁCH THIẾT BỊ ONLINE:</b>\n${deviceListMessage}\n<b>Chi tiết thiết bị lạ:</b>\n• <b>IP:</b> ${rogue.ip}\n• <b>MAC:</b> ${rogue.mac}\n• <b>Nhà sản xuất:</b> ${rogue.vendor}`);
                            } else {
                                sendTelegramNotification(`✅ <b>[QUÉT MẠNG HOÀN TẤT]</b>\nMạng an toàn, không phát hiện mối đe dọa nào.\n\n<b>• Dải IP mạng:</b> ${data.ip_range}\n<b>• Tổng thiết bị phát hiện:</b> ${systemState.activeDevices.length}\n\n<b>DANH SÁCH THIẾT BỊ ONLINE:</b>\n${deviceListMessage}`);
                            }
                        }

                        systemState.hasScanned = true;
                        initNetworkMap();
                        updateDeviceTable();
                        updateStatistics();
                        drawConnectionLines();
                    }
                } catch (e) { console.error("SSE parse error:", e); }
            }
        }

        systemState.isScanning = false;
        if (!systemState.hasScanned) {
            scanBadge.textContent = "Hoàn tất";
            scanBadge.className = "badge";
            addLog("[SCAN] Quét hoàn tất.", "success-log");
        }

    } catch (err) {
        console.error("Scan error:", err);
        systemState.isScanning = false;
        if (!isSilent) {
            scanBadge.textContent = "Lỗi kết nối Server";
            scanBadge.className = "badge danger";
            addLog("[LỖI] Không thể kết nối tới Python Scanner Backend thực tế!", "danger-log");
            addLog("➡ Hướng dẫn: Vui lòng chạy file `py scanner.py` bằng quyền Administrator trên máy tính.", "warning-log");
        }
        updateStatistics();
    }
}

btnScan.addEventListener('click', () => {
    executeScan(false);
});

// ==========================================
// CÁC SỰ KIỆN CỦA MODAL & NÚT RESET
// ==========================================
btnModalClose.addEventListener('click', () => {
    alertModal.classList.remove('active');
    addLog(`[UI] Đã bỏ qua cảnh báo. Thiết bị lạ vẫn đang kết nối trái phép!`, 'warning-log');
});

// Reset hệ thống về ban đầu
btnReset.addEventListener('click', () => {
    systemState = {
        isScanning: false,
        hasScanned: false,
        activeDevices: [],
        unauthorizedDetected: false,
        isRoguePresent: false,
        blockedDevices: new Set()
    };
    
    scanBadge.textContent = "Sẵn sàng";
    scanBadge.className = "badge";
    
    initNetworkMap();
    updateDeviceTable();
    updateStatistics();
    
    // Gửi yêu cầu reset lên Python server
    fetch(`${getBackendUrl()}/reset`)
        .then(() => {
            terminalLogs.innerHTML = '';
            addLog("[SYSTEM] Đã reset trạng thái Server và Web Dashboard về mặc định.");
        })
        .catch(() => {
            terminalLogs.innerHTML = '';
            addLog("[SYSTEM] Hệ thống đã được khôi phục về trạng thái mặc định.");
        });
        
    sendTelegramNotification(`🔄 <b>[RESET HỆ THỐNG]</b>\nĐã reset trạng thái giám sát về mặc định.`);
});

// ==========================================
// THỰC THI LỆNH TRÊN INTERACTIVE TERMINAL
// ==========================================
const terminalInput = document.getElementById('terminal-input');

if (terminalInput) {
    terminalInput.addEventListener('keydown', async (event) => {
        if (event.key === 'Enter') {
            const rawCmd = terminalInput.value;
            const cmd = rawCmd.trim();
            terminalInput.value = ''; // Xóa sạch ô nhập
            
            if (!cmd) return;
            
            // Hiển thị lệnh vừa gõ lên terminal logs
            addLog(`<span style="color: #fff; font-weight: bold;">&gt; ${cmd}</span>`, 'system-log');
            
            // Tách các thành phần của lệnh
            const parts = cmd.split(/\s+/);
            const primaryCmd = parts[0].toLowerCase();
            const args = parts.slice(1);
            
            switch (primaryCmd) {
                case 'help':
                    addLog("------------------------------------------------------------", "system-log");
                    addLog("HƯỚNG DẪN CÁC LỆNH TRONG TERMINAL:", "success-log");
                    addLog("  <strong>help</strong>                      : Hiển thị bảng trợ giúp này.", "system-log");
                    addLog("  <strong>scan</strong>                      : Khởi chạy quét mạng ARP thực tế.", "system-log");
                    addLog("  <strong>block &lt;mac|ip&gt;</strong>            : Cô lập thiết bị bằng ARP Poisoning.", "system-log");
                    addLog("  <strong>unblock &lt;mac|ip&gt;</strong>          : Khôi phục kết nối mạng cho thiết bị.", "system-log");
                    addLog("  <strong>whitelist list</strong>            : Xem danh sách thiết bị Whitelist.", "system-log");
                    addLog("  <strong>whitelist add &lt;mac&gt; &lt;tên&gt;</strong>: Thêm thiết bị vào danh sách trắng.", "system-log");
                    addLog("  <strong>whitelist remove &lt;mac&gt;</strong>   : Xóa thiết bị khỏi danh sách trắng.", "system-log");
                    addLog("  <strong>status</strong>                    : Xem trạng thái hệ thống hiện tại.", "system-log");
                    addLog("  <strong>reset</strong>                     : Khôi phục hệ thống về mặc định.", "system-log");
                    addLog("  <strong>clear</strong>                     : Xóa sạch toàn bộ log trong terminal.", "system-log");
                    addLog("------------------------------------------------------------", "system-log");
                    break;
                    
                case 'scan':
                    btnScan.click();
                    break;
                    
                case 'reset':
                    btnReset.click();
                    break;
                    
                case 'clear':
                    terminalLogs.innerHTML = '';
                    break;
                    
                case 'block':
                    if (args.length < 1) {
                        addLog("[LỖI] Cú pháp lệnh: block &lt;mac|ip&gt;", "danger-log");
                    } else {
                        const target = args[0].toLowerCase();
                        const device = systemState.activeDevices.find(d => 
                            d.mac.toLowerCase() === target || d.ip === target
                        );
                        if (device) {
                            if (device.type === 'router') {
                                addLog("[LỖI] Không thể chặn Gateway Router trung tâm!", "danger-log");
                            } else {
                                toggleBlockDevice(device.mac, true);
                            }
                        } else {
                            addLog(`[LỖI] Không tìm thấy thiết bị online nào có IP/MAC: ${target}`, "danger-log");
                        }
                    }
                    break;
                    
                case 'unblock':
                    if (args.length < 1) {
                        addLog("[LỖI] Cú pháp lệnh: unblock &lt;mac|ip&gt;", "danger-log");
                    } else {
                        const target = args[0].toLowerCase();
                        const device = systemState.activeDevices.find(d => 
                            d.mac.toLowerCase() === target || d.ip === target
                        );
                        if (device) {
                            toggleBlockDevice(device.mac, false);
                        } else {
                            if (systemState.blockedDevices.has(target) || systemState.blockedDevices.has(target.toUpperCase())) {
                                toggleBlockDevice(target, false);
                            } else {
                                addLog(`[LỖI] Thiết bị IP/MAC '${target}' không nằm trong danh sách chặn.`, "danger-log");
                            }
                        }
                    }
                    break;
                    
                case 'status':
                    addLog("------------------------------------------------------------", "system-log");
                    addLog("TRẠNG THÁI HỆ THốNG HIỆN TẠI:", "success-log");
                    addLog(`  • Đang quét: ${systemState.isScanning ? '✅ Có' : '❌ Không'}`, "system-log");
                    addLog(`  • Đã quét lần nào: ${systemState.hasScanned ? '✅ Rồi' : '❌ Chưa'}`, "system-log");
                    addLog(`  • Tổng thiết bị phát hiện: ${systemState.activeDevices.length}`, "system-log");
                    addLog(`  • Thiết bị bị chặn: ${systemState.blockedDevices.size}`, "system-log");
                    addLog(`  • Phát hiện trái phép: ${systemState.unauthorizedDetected ? '⚠️ Có' : '✅ Không'}`, "system-log");
                    addLog(`  • Backend: ${getBackendUrl()}`, "system-log");
                    addLog("------------------------------------------------------------", "system-log");
                    break;

                case 'whitelist':
                    if (args.length < 1) {
                        addLog("[LỖI] Cú pháp lệnh: whitelist &lt;list|add|remove&gt;", "danger-log");
                    } else {
                        const action = args[0].toLowerCase();
                        if (action === 'list') {
                            fetch(`${getBackendUrl()}/whitelist/list`)
                                .then(res => res.json())
                                .then(data => {
                                    addLog("------------------------------------------------------------", "system-log");
                                    addLog("DANH SÁCH THIẾT BỊ WHITELIST (HỢP LỆ) TRÊN SERVER:", "success-log");
                                    let i = 1;
                                    for (const [mac, name] of Object.entries(data.whitelist)) {
                                        addLog(`  ${i++}. <code>${mac}</code> &rarr; <strong>${name}</strong>`, "system-log");
                                    }
                                    addLog("------------------------------------------------------------", "system-log");
                                })
                                .catch(() => {
                                    addLog("[LỖI] Không thể kết nối tới Server.", "danger-log");
                                });
                        } else if (action === 'add') {
                            if (args.length < 3) {
                                addLog("[LỖI] Cú pháp lệnh: whitelist add &lt;mac&gt; &lt;tên thiết bị&gt;", "danger-log");
                            } else {
                                const mac = args[1];
                                const name = args.slice(2).join(" ");
                                const macRegex = /^([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})$/;
                                if (!macRegex.test(mac)) {
                                    addLog("[LỖI] Định dạng địa chỉ MAC không hợp lệ! Ví dụ mẫu: 0e:0f:73:e7:61:9e", "danger-log");
                                } else {
                                    fetch(`${getBackendUrl()}/whitelist/add?mac=${encodeURIComponent(mac)}&name=${encodeURIComponent(name)}`)
                                        .then(res => res.json())
                                        .then(data => {
                                            if (data.status === 'success') {
                                                addLog(`[WHITELIST] Đã thêm thành công: <code>${mac}</code> &rarr; <strong>${name}</strong>`, "success-log");
                                            } else {
                                                addLog(`[LỖI] Server báo lỗi: ${data.message}`, "danger-log");
                                            }
                                        })
                                        .catch(() => {
                                            addLog("[LỖI] Không thể kết nối tới Server.", "danger-log");
                                        });
                                }
                            }
                        } else if (action === 'remove') {
                            if (args.length < 2) {
                                addLog("[LỖI] Cú pháp lệnh: whitelist remove &lt;mac&gt;", "danger-log");
                            } else {
                                const mac = args[1];
                                fetch(`${getBackendUrl()}/whitelist/remove?mac=${encodeURIComponent(mac)}`)
                                    .then(res => res.json())
                                    .then(data => {
                                        if (data.status === 'success') {
                                            addLog(`[WHITELIST] Đã xóa địa chỉ MAC <code>${mac}</code> khỏi whitelist.`, "success-log");
                                        } else {
                                            addLog(`[LỖI] Server báo lỗi: ${data.message}`, "danger-log");
                                        }
                                    })
                                    .catch(() => {
                                        addLog("[LỖI] Không thể kết nối tới Server.", "danger-log");
                                    });
                            }
                        } else {
                            addLog("[LỖI] Hành động không rõ. Cú pháp: whitelist &lt;list|add|remove&gt;", "danger-log");
                        }
                    }
                    break;
                    
                case 'reset':
                    btnReset.click();
                    break;
                    
                case 'clear':
                    terminalLogs.innerHTML = '';
                    break;
                    
                default:
                    addLog(`[LỖI] Lệnh '${primaryCmd}' không hợp lệ. Gõ 'help' để xem danh sách lệnh.`, "danger-log");
            }
        }
    });
}

// ==========================================
// TỰ ĐỘNG CHẠY & GIÁM SÁT ĐỊNH KỲ (REALTIME AUTO MONITORING)
// ==========================================
let autoScanInterval = null;
let isAutoScanEnabled = true;

function initMobileAutoRun() {
    // 1. Tự động khởi chạy lần quét đầu tiên khi mở trang (sau 600ms)
    setTimeout(() => {
        if (!systemState.isScanning && !systemState.hasScanned) {
            addLog("[AUTO MONITOR] Tự động kích hoạt giám sát mạng thực tế...", "scan-log");
            if (btnScan) btnScan.click();
        }
    }, 600);

    // 2. Thiết lập chu kỳ tự động quét ngầm mỗi 15 giây
    if (!autoScanInterval) {
        autoScanInterval = setInterval(() => {
            if (isAutoScanEnabled && !systemState.isScanning && systemState.hasScanned) {
                executeScan(true);
            }
        }, 15000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initMobileAutoRun();

    // Xử lý thu gọn / mở rộng Terminal Logs
    const btnToggleTerminal = document.getElementById('btn-toggle-terminal');
    const terminalBodyWrapper = document.getElementById('terminal-body-wrapper');

    if (btnToggleTerminal && terminalBodyWrapper) {
        // Tự động thu gọn Terminal mặc định trên màn hình nhỏ di động
        if (window.innerWidth <= 768) {
            terminalBodyWrapper.classList.add('collapsed');
            btnToggleTerminal.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
        }

        btnToggleTerminal.addEventListener('click', () => {
            const isCollapsed = terminalBodyWrapper.classList.toggle('collapsed');
            btnToggleTerminal.innerHTML = isCollapsed 
                ? '<i class="fa-solid fa-chevron-down"></i>' 
                : '<i class="fa-solid fa-chevron-up"></i>';
        });
    }
});
