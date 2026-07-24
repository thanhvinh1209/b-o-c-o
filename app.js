// ==========================================
// CẤU HÌNH DỮ LIỆU THIẾT BỊ
// ==========================================

// Danh sách thiết bị hợp lệ (Whitelist)
const whitelistDevices = [
    {
        ip: "192.168.1.1",
        mac: "00:11:22:33:44:55",
        name: "Gateway Router (Trung tâm)",
        type: "router",
        icon: "fa-wifi",
        vendor: "Cisco Systems",
        authorized: true,
        angle: 0, // Vị trí trung tâm (đặc biệt)
        radius: 0
    },
    {
        ip: "192.168.1.12",
        mac: "24:fc:e5:aa:bb:cc",
        name: "Smart TV Phòng Khách",
        type: "smart-tv",
        icon: "fa-tv",
        vendor: "LG Electronics",
        authorized: true,
        angle: 30, // Góc độ để xếp thành vòng tròn xung quanh router
        radius: 130
    },
    {
        ip: "192.168.1.45",
        mac: "fc:db:b3:99:88:77",
        name: "IP Camera Ban Công",
        type: "camera",
        icon: "fa-video",
        vendor: "Hikvision",
        authorized: true,
        angle: 110,
        radius: 130
    },
    {
        ip: "192.168.1.72",
        mac: "00:e0:4c:78:90:ab",
        name: "Bóng Đèn Thông Minh",
        type: "smart-light",
        icon: "fa-lightbulb",
        vendor: "TP-Link",
        authorized: true,
        angle: 180,
        radius: 130
    },
    {
        ip: "192.168.1.100",
        mac: "aa:bb:cc:dd:ee:ff",
        name: "Laptop Học Tập (Admin)",
        type: "laptop",
        icon: "fa-laptop",
        vendor: "Apple",
        authorized: true,
        angle: 250,
        radius: 130
    }
];

// Thiết bị trái phép để giả lập
const rogueDevice = {
    ip: "192.168.1.189",
    mac: "bc:d1:d3:ef:22:90",
    name: "Thiết bị lạ (Nghi vấn Hacker)",
    type: "unknown",
    icon: "fa-user-secret",
    vendor: "Generic Linux OS (Tấn công mạng)",
    authorized: false,
    angle: 310,
    radius: 130
};

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

// ==========================================
// KHỞI TẠO DOM ELEMENTS
// ==========================================
const btnScan = document.getElementById('btn-scan');
const btnSimulateRogue = document.getElementById('btn-simulate-rogue');
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
    const topOffset = 50 + (device.radius / 2.5) * Math.sin(angleRad);
    
    node.style.left = `${leftOffset}%`;
    node.style.top = `${topOffset}%`;
    
    // Icon thiết bị
    const iconClass = isBlocked ? 'fa-ban' : device.icon;
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

        // Action button
        let actionBtn = '';
        if (device.type !== 'router') {
            if (isBlocked) {
                actionBtn = `<button class="btn-action btn-unblock" onclick="toggleBlockDevice('${device.mac}', false)"><i class="fa-solid fa-unlock"></i> Bỏ chặn</button>`;
            } else {
                actionBtn = `<button class="btn-action" onclick="toggleBlockDevice('${device.mac}', true)"><i class="fa-solid fa-ban"></i> Cô lập</button>`;
            }
        } else {
            actionBtn = `<span class="text-muted" style="font-size: 11px;">Không có</span>`;
        }

        tr.innerHTML = `
            <td><strong>${device.ip}</strong></td>
            <td><code>${device.mac}</code></td>
            <td><i class="fa-solid ${device.icon}"></i> ${device.name}</td>
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
    } else {
        systemState.blockedDevices.delete(mac);
        addLog(`[MITIGATION] Đã ngưng ARP Poisoning. Thiết bị ${device.ip} được khôi phục kết nối.`, 'system-log');
    }

    // Gửi yêu cầu chặn/bỏ chặn lên Python Backend để đồng bộ log terminal
    const action = shouldBlock ? 'block' : 'unblock';
    fetch(`http://127.0.0.1:5000/${action}?mac=${mac}&ip=${device.ip}`)
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
// HÀM CHẠY QUÉT GIẢ LẬP (FALLBACK)
// ==========================================
function runSimulation() {
    addLog("[SCAN] Bắt đầu khởi chạy bộ quét mạng giả lập...", "scan-log");
    addLog("[SCAN] Đang gửi các gói tin ARP Request (Broadcast) đến dải IP giả lập...", "scan-log");
    
    let currentDeviceIndex = 0;
    
    function scanNext() {
        if (currentDeviceIndex >= whitelistDevices.length) {
            // Hoàn tất quét
            systemState.isScanning = false;
            systemState.hasScanned = true;
            
            addLog(`[SCAN SUCCESS] Quét mạng hoàn tất! Phát hiện ${systemState.activeDevices.length} thiết bị đang hoạt động.`, "success-log");
            addLog(`[SYSTEM] Đối chiếu cơ sở dữ liệu Whitelist: 100% thiết bị đều HỢP LỆ.`, "success-log");
            
            updateStatistics();
            drawConnectionLines(); // Cập nhật lại màu đường kết nối
            return;
        }

        const device = whitelistDevices[currentDeviceIndex];
        
        setTimeout(() => {
            // Thêm thiết bị vào danh sách active
            systemState.activeDevices.push(device);
            
            // Nhật ký log quét
            addLog(`[ARP Response] Phát hiện IP: ${device.ip} | MAC: ${device.mac} (${device.vendor})`, "success-log");
            addLog(` -> So khớp Whitelist: OK. Đã thêm thiết bị [${device.name}] vào bản đồ mạng.`, "system-log");

            // Cập nhật giao diện
            createDeviceNode(device);
            drawConnectionLines();
            updateDeviceTable();
            updateStatistics();

            currentDeviceIndex++;
            scanNext();
        }, 800); // 800ms phát hiện 1 thiết bị cho trực quan
    }

    scanNext();
}

// ==========================================
// HÀNH VI QUÉT MẠNG THẬT/MÔ PHỎNG
// ==========================================
btnScan.addEventListener('click', () => {
    if (systemState.isScanning) return;
    
    // Reset trạng thái quét mới
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

    addLog("[SCAN] Đang kết nối tới Python Scanner Backend (http://127.0.0.1:5000)...", "scan-log");

    fetch("http://127.0.0.1:5000/scan")
        .then(response => response.json())
        .then(data => {
            // Cập nhật dải IP thật lên giao diện
            document.getElementById('info-ip-range').textContent = data.ip_range;
            
            // Xóa log cũ và in log mới giống hệt trên Terminal
            terminalLogs.innerHTML = '';
            addLog("============================================================", "system-log");
            addLog("    HE THONG PHAT HIEN THIET BI TRAI PHEP TRONG MANG IOT", "system-log");
            addLog("============================================================", "system-log");
            addLog(`[*] IP máy tính của bạn: ${data.local_ip}`, "system-log");
            addLog(`[*] Dải mạng nội bộ: ${data.ip_range}`, "system-log");
            addLog(`[*] Số lượng thiết bị trong Whitelist: ${Object.keys(data.whitelist).length} thiết bị.`, "system-log");
            addLog("------------------------------------------------------------", "system-log");
            addLog(`[*] Đang khởi tạo quét mạng trên dải IP: ${data.ip_range}...`, "scan-log");
            addLog(`[*] Tự động chọn card mạng: Card mạng hoạt động`, "scan-log");
            addLog("============================================================", "system-log");
            addLog(`    KET QUA QUET MANG (Tìm thấy ${data.devices.length} thiết bị đang online)`, "system-log");
            addLog("============================================================", "system-log");
            addLog(`STT   Địa chỉ IP        Địa chỉ MAC         Trạng thái / Tên thiết bị`, "system-log");
            addLog("------------------------------------------------------------", "system-log");

            // Phân loại thiết bị Router chính và các thiết bị còn lại
            const nonRouterDevices = data.devices.filter(d => d.type !== 'router');
            const routerDevice = data.devices.find(d => d.type === 'router') || {
                ip: "192.168.1.1",
                mac: "00:11:22:33:44:55",
                name: "Gateway Router (Trung tâm)",
                type: "router",
                icon: "fa-wifi",
                vendor: "Cisco Systems",
                authorized: true
            };
            
            // Router trung tâm
            systemState.activeDevices = [
                { ...routerDevice, angle: 0, radius: 0 }
            ];
            
            // Định vị trí các thiết bị xung quanh router
            const count = nonRouterDevices.length;
            nonRouterDevices.forEach((dev, idx) => {
                const angle = count > 0 ? (idx * (360 / count)) : 0;
                systemState.activeDevices.push({
                    ...dev,
                    angle: angle,
                    radius: 130
                });
            });
            
            // Vẽ bản đồ
            initNetworkMap();
            
            // In chi tiết từng thiết bị ra web terminal
            let unauthorizedCount = 0;
            data.devices.forEach((dev, idx) => {
                const num = (idx + 1).toString().padEnd(4, ' ');
                const ipStr = dev.ip.padEnd(16, ' ');
                const macStr = dev.mac.padEnd(18, ' ');
                
                let statusStr = "";
                let logClass = "";
                if (dev.authorized) {
                    statusStr = `hợp lệ - ${dev.name}`;
                    logClass = "success-log";
                } else {
                    statusStr = `CẢNH BÁO: TRÁI PHÉP (UNKNOWN DEVICE)!`;
                    logClass = "alert-log";
                    unauthorizedCount++;
                }
                addLog(`${num}  ${ipStr}  ${macStr}  ${statusStr}`, logClass);
            });
            
            addLog("------------------------------------------------------------", "system-log");
            
            systemState.isScanning = false;
            systemState.hasScanned = true;
            
            // Kiểm tra và báo động thiết bị trái phép
            const unauthorizedDevices = data.devices.filter(d => !d.authorized);
            if (unauthorizedDevices.length > 0) {
                systemState.unauthorizedDetected = true;
                playAlarmSound();
                
                addLog(`[CẢNH BÁO NGUY HIỂM] Phát hiện ${unauthorizedCount} thiết bị TRÁI PHÉP kết nối vào mạng!`, "danger-log");
                addLog(" -> Hãy kiểm tra lại địa chỉ MAC của thiết bị đó.", "warning-log");
                
                // Show modal với thiết bị lạ đầu tiên
                const rogue = unauthorizedDevices[0];
                modalIp.textContent = rogue.ip;
                modalMac.textContent = rogue.mac;
                modalVendor.textContent = rogue.vendor;
                
                btnModalBlock.onclick = function() {
                    toggleBlockDevice(rogue.mac, true);
                };
                
                alertModal.classList.add('active');
            } else {
                addLog("[AN TOÀN] Không phát hiện thiết bị lạ nào trong mạng nội bộ.", "success-log");
            }
            addLog("============================================================", "system-log");
            
            updateDeviceTable();
            updateStatistics();
            drawConnectionLines();
        })
        .catch(err => {
            addLog("[WARNING] Không kết nối được API Python (Server chưa bật).", "warning-log");
            addLog(" -> Tự động chuyển hướng sang chế độ GIẢ LẬP...", "warning-log");
            runSimulation();
        });
});

// ==========================================
// GIẢ LẬP XÂM NHẬP THIẾT BỊ TRÁI PHÉP
// ==========================================
btnSimulateRogue.addEventListener('click', () => {
    // Thử gửi yêu cầu giả lập xâm nhập lên Python server trước
    fetch("http://127.0.0.1:5000/simulate_rogue")
        .then(res => res.json())
        .then(data => {
            systemState.isRoguePresent = true;
            addLog("[ALERT] Đã yêu cầu Python Server giả lập chèn thiết bị lạ.", "warning-log");
            addLog(" -> Vui lòng nhấn nút 'Bắt đầu Quét Mạng' trên Web để quét thiết bị thật kèm thiết bị lạ.", "warning-log");
            alert("Đã kích hoạt giả lập trên Server! Hãy nhấn nút 'Bắt đầu Quét Mạng' để phát hiện cảnh báo.");
        })
        .catch(err => {
            // Fallback sang giả lập hoàn toàn trên Web nếu không kết nối được Python
            if (!systemState.hasScanned && !systemState.isScanning) {
                alert("Vui lòng nhấn 'Bắt đầu Quét Mạng' trước khi giả lập thiết bị lạ kết nối.");
                return;
            }
            if (systemState.isRoguePresent) {
                alert("Thiết bị trái phép đã có mặt trong mạng rồi!");
                return;
            }

            systemState.isRoguePresent = true;
            addLog(`[ALERT] Phát hiện lưu lượng mạng bất thường tại IP ${rogueDevice.ip}...`, 'warning-log');
            
            setTimeout(() => {
                systemState.activeDevices.push(rogueDevice);
                
                addLog(`[ARP Response] IP: ${rogueDevice.ip} | MAC: ${rogueDevice.mac} (Nhà sản xuất: Không rõ)`, 'alert-log');
                addLog(`[CẢNH BÁO NGUY HIỂM] Địa chỉ MAC ${rogueDevice.mac} KHÔNG nằm trong danh sách thiết bị được phép!`, 'alert-log');
                addLog(`[SYSTEM ALERT] Thiết bị trái phép [${rogueDevice.name}] đang truy cập bất hợp pháp!`, 'alert-log');

                playAlarmSound();
                createDeviceNode(rogueDevice);
                drawConnectionLines();
                updateDeviceTable();
                updateStatistics();

                modalIp.textContent = rogueDevice.ip;
                modalMac.textContent = rogueDevice.mac;
                modalVendor.textContent = rogueDevice.vendor;
                alertModal.classList.add('active');
            }, 1200);
        });
});

// ==========================================
// CÁC SỰ KIỆN CỦA MODAL & NÚT RESET
// ==========================================
btnModalClose.addEventListener('click', () => {
    alertModal.classList.remove('active');
    addLog(`[UI] Đã bỏ qua cảnh báo. Thiết bị lạ vẫn đang kết nối trái phép!`, 'warning-log');
});

btnModalBlock.addEventListener('click', () => {
    toggleBlockDevice(rogueDevice.mac, true);
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
    fetch("http://127.0.0.1:5000/reset")
        .then(() => {
            terminalLogs.innerHTML = '';
            addLog("[SYSTEM] Đã reset trạng thái Server và Web Dashboard về mặc định.");
        })
        .catch(err => {
            terminalLogs.innerHTML = '';
            addLog("[SYSTEM] Hệ thống (giả lập) đã được khôi phục về trạng thái mặc định ban đầu.");
        });
});
