// ==========================================
// CẤU HÌNH DỮ LIỆU THIẾT BỊ
// ==========================================

// Đọc/Ghi URL Python Backend linh hoạt (mặc định localhost hoặc ngrok URL)
const inputBackendUrl = document.getElementById('input-backend-url');
const savedBackendUrl = localStorage.getItem('iot_guard_backend_url');

if (savedBackendUrl && inputBackendUrl) {
    inputBackendUrl.value = savedBackendUrl;
}

// Cấu hình Telegram Alerts
const inputTgToken = document.getElementById('input-tg-token');
const inputTgChatId = document.getElementById('input-tg-chatid');

if (inputTgToken) {
    inputTgToken.value = localStorage.getItem('tg_bot_token') || '';
    inputTgToken.addEventListener('input', () => {
        localStorage.setItem('tg_bot_token', inputTgToken.value.trim());
    });
}

if (inputTgChatId) {
    inputTgChatId.value = localStorage.getItem('tg_chat_id') || '';
    inputTgChatId.addEventListener('input', () => {
        localStorage.setItem('tg_chat_id', inputTgChatId.value.trim());
    });
}

async function sendTelegramNotification(message) {
    const token = (inputTgToken ? inputTgToken.value.trim() : null) || localStorage.getItem('tg_bot_token');
    const chatId = (inputTgChatId ? inputTgChatId.value.trim() : null) || localStorage.getItem('tg_chat_id');
    if (!token || !chatId) return;

    try {
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
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

window.testTelegramConnection = async function() {
    const token = inputTgToken ? inputTgToken.value.trim() : '';
    const chatId = inputTgChatId ? inputTgChatId.value.trim() : '';

    if (!token || !chatId) {
        addLog('[TELEGRAM] ❌ Vui lòng nhập đủ Bot Token và Chat ID trước!', 'danger-log');
        return;
    }

    localStorage.setItem('tg_bot_token', token);
    localStorage.setItem('tg_chat_id', chatId);

    const btn = document.getElementById('btn-tg-test');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang gửi...'; }

    addLog('[TELEGRAM] Đang gửi tin nhắn thử nghiệm tới Telegram...', 'scan-log');

    const ok = await sendTelegramNotification(`🔔 <b>IoT Guard - Kết nối thành công!</b>\n\nBot Telegram đã được cấu hình xong và đang hoạt động bình thường.\n✅ Từ giờ bạn sẽ nhận được thông báo realtime khi:\n• Phát hiện thiết bị xâm nhập\n• Cấp phép / hủy cấp phép thiết bị\n• Cô lập hoặc mở chặn thiết bị`);

    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Gửi tin nhắn thử nghiệm'; }

    if (ok) {
        addLog('[TELEGRAM] ✅ Gửi thành công! Kiểm tra điện thoại của bạn ngay nhé.', 'success-log');
    } else {
        addLog('[TELEGRAM] ❌ Gửi thất bại! Kiểm tra lại Bot Token và Chat ID có đúng không.', 'danger-log');
    }
};

window.toggleTelegramConfig = function() {
    const body = document.getElementById('tg-config-body');
    const icon = document.getElementById('tg-toggle-icon');
    if (!body) return;
    const isHidden = body.style.display === 'none';
    body.style.display = isHidden ? 'flex' : 'none';
    if (icon) icon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
};

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
btnScan.addEventListener('click', async () => {
    if (systemState.isScanning) return;

    systemState.isScanning = true;
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

    try {
        const response = await fetch(`${getBackendUrl()}/scan`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        addLog("[OK] Kết nối Backend thành công! Đang quét mạng thực tế...", "success-log");

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
                        addLog(payload.message, payload.level);
                    } else if (payload.type === "result") {
                        const data = payload.data;
                        document.getElementById('info-ip-range').textContent = data.ip_range;
                        const nonRouterDevices = data.devices.filter(d => d.type !== 'router');
                        const routerDevice = data.devices.find(d => d.type === 'router') || {
                            ip: "192.168.1.1", mac: "00:11:22:33:44:55",
                            name: "Gateway Router (Trung tâm)", type: "router",
                            icon: "fa-wifi", vendor: "Cisco Systems", authorized: true
                        };
                        systemState.activeDevices = [{ ...routerDevice, angle: 0, radius: 0 }];
                        const count = nonRouterDevices.length;
                        nonRouterDevices.forEach((dev, i) => {
                            const pos = getDevicePosition(i, count);
                            systemState.activeDevices.push({
                                ...dev,
                                angle: pos.angle,
                                radius: pos.radius
                            });
                        });
                        initNetworkMap();
                        systemState.isScanning = false;
                        systemState.hasScanned = true;
                        const unauthorizedDevices = data.devices.filter(d => !d.authorized);
                        if (unauthorizedDevices.length > 0) {
                            systemState.unauthorizedDetected = true;
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
                            
                            sendTelegramNotification(`⚠️ <b>[CẢNH BÁO XÂM NHẬP]</b>\nPhát hiện thiết bị TRÁI PHÉP kết nối vào mạng IoT!\n\n• <b>IP:</b> ${rogue.ip}\n• <b>MAC:</b> ${rogue.mac}\n• <b>Nhà sản xuất:</b> ${rogue.vendor}`);
                        } else {
                            sendTelegramNotification(`✅ <b>[QUÉT MẠNG HOÀN TẤT]</b>\nKhông phát hiện mối đe dọa nào. Mạng an toàn.\n• <b>Tổng thiết bị online:</b> ${count + 1}`);
                        }
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
        
        if (confirm("Không kết nối được tới Python Backend (hoặc do chạy trên GitHub Pages).\n\nBạn có muốn chuyển sang CHẾ ĐỘ GIẢ LẬP (Demo Mode) để chạy thử giao diện không?")) {
            runDemoSimulation();
        } else {
            scanBadge.textContent = "Lỗi kết nối";
            scanBadge.className = "badge danger";
            addLog("[LỖI] Không thể kết nối tới Python Scanner Backend!", "danger-log");
            addLog("➡ Hướng dẫn: Mở Command Prompt bằng quyền Administrator, vào thư mục d:\\iot rồi chạy: khoi_chay.bat", "warning-log");
            addLog("➡ Hoặc chạy trực tiếp: py -u scanner.py (trong thư mục d:\\iot)", "warning-log");
            updateStatistics();
        }
    }
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
    
    // Gửi yêu cầu reset lên Python server (bỏ qua lỗi nếu không có backend)
    demoRogueActive = false;
    IS_DEMO_MODE = false;
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
// CHẾ ĐỘ GIẢ LẬP (DEMO MODE) CHO GITHUB PAGES
// ==========================================
async function runDemoSimulation() {
    systemState.isScanning = true;
    systemState.hasScanned = false;
    systemState.activeDevices = [];
    systemState.isRoguePresent = false;
    systemState.unauthorizedDetected = false;
    systemState.blockedDevices.clear();

    scanBadge.textContent = "Đang quét (Demo)...";
    scanBadge.className = "badge scanning";
    initNetworkMap();
    updateDeviceTable();
    updateStatistics();
    
    terminalLogs.innerHTML = '';
    addLog("[DEMO] Đang khởi chạy quét mạng GIẢ LẬP (Không kết nối Backend)...", "scan-log");
    
    sendTelegramNotification(`🔍 <b>[BẮT ĐẦU QUÉT MẠNG - GIẢ LẬP]</b>\nHệ thống bắt đầu quét ở chế độ Demo (không kết nối Backend)...`);
    
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    
    await sleep(800);
    addLog("[DEMO] Địa chỉ IP máy tính giả lập: 192.168.1.15", "system-log");
    addLog("[DEMO] Dải mạng quét giả lập: 192.168.1.0/24", "system-log");
    addLog("[DEMO] Khởi động gửi gói tin ARP request broadcast...", "scan-log");
    
    await sleep(1000);
    addLog("[+] Đang nhận phản hồi ARP từ các thiết bị...", "scan-log");
    addLog("[+] Đang nhận diện nhà sản xuất (OUI lookup)...", "system-log");
    
    await sleep(1200);
    document.getElementById('info-ip-range').textContent = "192.168.1.0/24 (Giả lập)";
    
    const mockDevices = [
        {
            ip: "192.168.1.1",
            mac: "00:11:22:33:44:55",
            name: "Gateway Router (Trung tâm)",
            type: "router",
            icon: "fa-wifi",
            vendor: "Cisco Systems",
            authorized: true
        },
        {
            ip: "192.168.1.10",
            mac: "40:23:43:af:80:83",
            name: "Máy tính của tôi",
            type: "laptop",
            icon: "fa-laptop",
            vendor: "Intel Corp",
            authorized: true
        },
        {
            ip: "192.168.1.15",
            mac: "0e:0f:73:e7:61:9e",
            name: "Điện thoại của tôi",
            type: "phone",
            icon: "fa-mobile-screen-button",
            vendor: "Apple Inc (iPhone)",
            authorized: true
        },
        {
            ip: "192.168.1.120",
            mac: "ec:fa:bc:11:22:33",
            name: "Bóng đèn thông minh",
            type: "iot",
            icon: "fa-microchip",
            vendor: "Tuya Smart (IoT)",
            authorized: true
        },
        {
            ip: "192.168.1.189",
            mac: "bc:d1:d3:ef:22:90",
            name: "IP Camera lạ",
            type: "camera",
            icon: "fa-video",
            vendor: "Generic IP Camera (Rogue)",
            authorized: false
        }
    ];

    const routerDevice = mockDevices.find(d => d.type === 'router');
    const nonRouterDevices = mockDevices.filter(d => d.type !== 'router');
    
    systemState.activeDevices = [{ ...routerDevice, angle: 0, radius: 0 }];
    const count = nonRouterDevices.length;
    nonRouterDevices.forEach((dev, i) => {
        const pos = getDevicePosition(i, count);
        systemState.activeDevices.push({
            ...dev,
            angle: pos.angle,
            radius: pos.radius
        });
    });

    initNetworkMap();
    systemState.isScanning = false;
    systemState.hasScanned = true;
    
    addLog("============================================================", "system-log");
    addLog("    KET QUA QUET GIẢ LẬP (Tìm thấy 5 thiết bị online)", "system-log");
    addLog("============================================================", "system-log");
    addLog("1    192.168.1.1       00:11:22:33:44:55   hợp lệ - Gateway Router", "success-log");
    addLog("2    192.168.1.10      40:23:43:af:80:83   hợp lệ - Máy tính của tôi", "success-log");
    addLog("3    192.168.1.15      0e:0f:73:e7:61:9e   hợp lệ - Điện thoại của tôi", "success-log");
    addLog("4    192.168.1.120     ec:fa:bc:11:22:33   hợp lệ - Bóng đèn thông minh", "success-log");
    addLog("5    192.168.1.189     bc:d1:d3:ef:22:90   CẢNH BÁO: TRÁI PHÉP (UNKNOWN DEVICE)!", "alert-log");
    addLog("------------------------------------------------------------", "system-log");
    addLog("[CẢNH BÁO NGUY HIỂM] Phát hiện 1 thiết bị TRÁI PHÉP kết nối vào mạng!", "danger-log");
    addLog(" -> Hãy kiểm tra lại địa chỉ MAC của thiết bị đó.", "warning-log");
    addLog("============================================================", "system-log");

    systemState.unauthorizedDetected = true;
    playAlarmSound();

    const rogue = mockDevices.find(d => !d.authorized);
    modalIp.textContent = rogue.ip;
    modalMac.textContent = rogue.mac;
    modalVendor.textContent = rogue.vendor;
    btnModalBlock.onclick = () => toggleBlockDevice(rogue.mac, true);
    
    const btnModalAuthorize = document.getElementById('btn-modal-authorize');
    if (btnModalAuthorize) {
        btnModalAuthorize.onclick = () => authorizeDevice(rogue.mac, rogue.name);
    }
    
    alertModal.classList.add('active');
    
    sendTelegramNotification(`⚠️ <b>[CẢNH BÁO XÂM NHẬP - GIẢ LẬP]</b>\nPhát hiện thiết bị giả lập TRÁI PHÉP kết nối vào mạng IoT!\n\n• <b>IP:</b> ${rogue.ip}\n• <b>MAC:</b> ${rogue.mac}\n• <b>Nhà sản xuất:</b> ${rogue.vendor}`);

    updateDeviceTable();
    updateStatistics();
    drawConnectionLines();
}
