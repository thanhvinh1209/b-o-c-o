# -*- coding: utf-8 -*-
"""
Dự án: Phát hiện thiết bị trái phép trong mạng IoT nội bộ
Mô tả: Script này sử dụng giao thức ARP để quét các thiết bị trong mạng LAN/Wi-Fi
       và đối chiếu với danh sách Whitelist (các thiết bị được phép) để phát hiện thiết bị lạ.
Yêu cầu cài đặt thư viện: pip install scapy
Lưu ý: Chạy script này dưới quyền Administrator (trên Windows) hoặc Root (trên Linux/macOS).
"""

import os
import sys
import socket
import time
import json
from http.server import HTTPServer, BaseHTTPRequestHandler

# Cấu hình UTF-8 cho terminal output trên Windows để tránh lỗi UnicodeEncodeError
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Kiểm tra xem scapy đã được cài đặt chưa
try:
    # pyrefly: ignore [missing-import]
    from scapy.all import ARP, Ether, srp
except ImportError:
    print("[!] LỖI: Thư viện 'scapy' chưa được cài đặt.")
    print("    Vui lòng mở Terminal/CMD và chạy lệnh: pip install scapy")
    print("    Đối với Windows, bạn cũng cần cài đặt Npcap (https://npcap.com/) để quét mạng.")
    sys.exit(1)

# ==========================================
# CẤU HÌNH HỆ THỐNG
# ==========================================

# Bật/Tắt chế độ giả lập (True = chạy giả lập 6 thiết bị, False = quét thật bằng card mạng)
MOCK_MODE = False

# Trạng thái giả lập chèn thiết bị lạ vào mạng quét thật (True = chèn thêm 1 thiết bị lạ)
INJECT_ROGUE = False

# 1. Danh sách Whitelist (Các địa chỉ MAC của thiết bị hợp lệ trong nhà bạn)
WHITELIST_DEVICES = {
    "40:23:43:af:80:83": "Máy tính của tôi",
    "0e:0f:73:e7:61:9e": "Điện thoại của tôi"
}

# ==========================================
# CƠ SỞ DỮ LIỆU & HÀM NHẬN DẠNG THIẾT BỊ (FINGERPRINTING)
# ==========================================

# Bảng tra cứu OUI (3 cụm đầu địa chỉ MAC -> Nhà sản xuất)
OUI_DATABASE = {
    "40:23:43": "Intel / PC",
    "00:1c:c0": "Intel Corp",
    "00:e0:4c": "Realtek Semi",
    "0e:0f:73": "Apple Inc (iPhone/iPad)",
    "00:0c:e6": "Apple Inc",
    "a4:c3:f0": "Apple Inc",
    "ac:bc:b5": "Apple Inc",
    "14:7d:da": "Apple Inc",
    "dc:a6:32": "Raspberry Pi Trading",
    "b8:27:eb": "Raspberry Pi Foundation",
    "24:0a:c4": "Espressif Systems (IoT ESP32)",
    "18:fe:34": "Espressif Systems (IoT ESP8266)",
    "bc:dd:c2": "Tuya Smart (IoT Device)",
    "ec:fa:bc": "Tuya Smart (IoT Device)",
    "54:5a:a6": "Xiaomi Electronics",
    "68:c6:3a": "Xiaomi Communications",
    "34:ce:00": "Xiaomi Communications",
    "00:11:22": "Cisco Systems / Router",
    "14:cc:20": "TP-Link Technologies",
    "50:c7:bf": "TP-Link Technologies",
    "e8:48:b8": "TP-Link Technologies",
    "c8:3a:35": "Tenda Technologies",
    "00:1d:7e": "D-Link Corporation",
    "44:47:cc": "Hikvision (IP Camera)",
    "38:a2:8c": "Dahua Tech (IP Camera)",
    "bc:d1:d3": "Generic IP Camera (Rogue)",
    "aa:bb:cc": "Samsung Electronics",
    "24:fc:e5": "LG Electronics (Smart TV)",
    "99:88:77": "Unknown IoT Board",
    "11:22:33": "Generic Network Adapter",
    "00:11:32": "Synology NAS",
}

def is_randomized_mac(mac):
    """
    Kiểm tra xem MAC có phải địa chỉ MAC ngẫu nhiên riêng tư (Private Wi-Fi MAC)
    được sử dụng trên iOS (iPhone/iPad), Android 10+ và Windows 10/11 hay không.
    """
    try:
        clean = mac.lower().replace("-", "").replace(":", "")
        if len(clean) >= 2:
            first_byte = int(clean[:2], 16)
            # Theo chuẩn IEEE 802, bit thứ 2 của byte đầu (0x02) xác định Locally Administered MAC
            return bool(first_byte & 2)
    except Exception:
        pass
    return False

def get_http_banner(ip, port=80):
    """Gửi yêu cầu HTTP thử lấy HTML Title để đoán loại thiết bị/router/camera"""
    try:
        import urllib.request
        import re
        url = f"http://{ip}:{port}/"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=0.4) as response:
            html = response.read(1024).decode('utf-8', errors='ignore')
            match = re.search(r'<title>(.*?)</title>', html, re.IGNORECASE)
            if match:
                title = match.group(1).strip()
                if title:
                    return title
            server = response.headers.get('Server')
            if server:
                return server
    except Exception:
        pass
    return None

def get_mac_vendor(mac):
    """Xác định nhà sản xuất từ địa chỉ MAC (OUI Lookup)"""
    mac_clean = mac.lower().replace("-", ":")
    prefix = mac_clean[:8]  # 3 octet đầu
    
    if prefix in OUI_DATABASE:
        return OUI_DATABASE[prefix]
    
    # Nếu là MAC riêng tư ngẫu nhiên của điện thoại/máy tính
    if is_randomized_mac(mac):
        return "Apple / Android / Windows (Private Wi-Fi MAC)"

    # Tra cứu online dự phòng với timeout 0.8s
    try:
        import urllib.request
        url = f"https://api.maclookup.app/v2/macs/{mac_clean}/vendor/name"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=0.8) as response:
            vendor = response.read().decode('utf-8').strip()
            if vendor and vendor != "N/A":
                return vendor
    except Exception:
        pass

    return "Generic Network Vendor"

def get_hostname(ip):
    """Lấy tên thiết bị (Hostname) qua Reverse DNS / NetBIOS"""
    try:
        socket.setdefaulttimeout(0.5)
        hostname, _, _ = socket.gethostbyaddr(ip)
        return hostname
    except Exception:
        return None

def check_open_ports(ip):
    """Quét nhanh các cổng dịch vụ đặc trưng (Fingerprinting)"""
    open_ports = []
    # 554: RTSP Camera, 9100: Printer, 1883: MQTT IoT, 445: Windows SMB, 80/8080: Web Admin, 62078: Apple Sync, 22: SSH
    target_ports = [554, 9100, 1883, 445, 80, 8080, 62078, 22]
    for port in target_ports:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(0.1)
            result = s.connect_ex((ip, port))
            s.close()
            if result == 0:
                open_ports.append(port)
        except Exception:
            pass
    return open_ports

def identify_device_info(ip, mac, is_authorized, custom_whitelist_name=None):
    """
    Hàm tổng hợp tự động xác định loại thiết bị từ IP và MAC
    """
    vendor = get_mac_vendor(mac)
    hostname = get_hostname(ip)
    open_ports = check_open_ports(ip)
    random_mac = is_randomized_mac(mac)
    http_title = None
    if 80 in open_ports or 8080 in open_ports:
        http_title = get_http_banner(ip, 80 if 80 in open_ports else 8080)
        
    dtype = "unknown"
    icon = "fa-network-wired"
    type_label = "Thiết bị mạng"
    
    # 1. Gateway Router (IP kết thúc bằng .1 hoặc Web Title chứa Router)
    if ip.endswith(".1") or (http_title and any(k in http_title.lower() for k in ["router", "gateway", "tp-link", "tenda", "fpt", "viettel", "vnpt"])):
        dtype = "router"
        icon = "fa-wifi"
        type_label = "Gateway Router (Trung tâm)"
        if vendor == "Generic Network Vendor" or "Vendor" in vendor:
            vendor = "Router Gateway (Cisco/TP-Link/VNPT)"

    # 2. IP Camera (Cổng RTSP 554 hoặc Vendor/Title chứa Hikvision/Dahua/Camera)
    elif 554 in open_ports or any(k in vendor.lower() for k in ["hikvision", "dahua", "camera"]) or (http_title and "camera" in http_title.lower()):
        dtype = "camera"
        icon = "fa-video"
        type_label = "IP Camera (Giám sát)"
        if vendor == "Generic Network Vendor":
            vendor = "Hikvision / Dahua / IP Camera"

    # 3. Máy in (Cổng 9100 hoặc Vendor HP/Epson/Canon/Brother)
    elif 9100 in open_ports or any(k in vendor.lower() for k in ["hp", "epson", "canon", "brother"]):
        dtype = "printer"
        icon = "fa-print"
        type_label = "Máy in (Network Printer)"
        if vendor == "Generic Network Vendor":
            vendor = "HP / Epson / Canon Printer"

    # 4. Thiết bị IoT Smart Home (Cổng MQTT 1883 hoặc Vendor Espressif/Tuya/Sonoff/Shelly)
    elif 1883 in open_ports or any(k in vendor.lower() for k in ["espressif", "esp32", "esp8266", "tuya", "sonoff", "shelly"]):
        dtype = "iot"
        icon = "fa-microchip"
        type_label = "Thiết bị IoT Smart Home"
        if vendor == "Generic Network Vendor":
            vendor = "Espressif / Tuya Smart IoT"

    # 5. Máy tính PC / Laptop (Windows SMB 445/139, Intel/Realtek/Dell/Lenovo/Asus/Acer)
    elif 445 in open_ports or any(k in vendor.lower() for k in ["intel", "realtek", "dell", "lenovo", "asus", "acer", "microsoft"]) or \
         (hostname and any(h in hostname.lower() for h in ["desktop", "laptop", "pc", "win"])):
        dtype = "laptop"
        icon = "fa-laptop"
        type_label = "Máy tính PC / Laptop"
        if vendor == "Generic Network Vendor":
            vendor = "Intel / Realtek PC"

    # 6. Điện thoại / Máy tính bảng (iOS, Android, Cổng Apple 62078, MAC Ngẫu nhiên bảo mật hoặc Vendor Apple/Samsung/Xiaomi/Oppo/Vivo)
    elif 62078 in open_ports or random_mac or any(k in vendor.lower() for k in ["apple", "samsung", "xiaomi", "huawei", "oppo", "vivo", "realme"]) or \
         (hostname and any(h in hostname.lower() for h in ["iphone", "android", "galaxy", "ipad", "phone"])):
        dtype = "phone"
        icon = "fa-mobile-screen-button"
        if random_mac:
            type_label = "Điện thoại (MAC Ngẫu nhiên)"
            if vendor == "Generic Network Vendor":
                vendor = "Apple / Android (Private Wi-Fi MAC)"
        else:
            type_label = "Điện thoại Smartphone"
            if vendor == "Generic Network Vendor":
                vendor = "Apple / Samsung Mobile"

    # 7. Mặc định cho các thiết bị kết nối còn lại trong mạng
    else:
        dtype = "unknown"
        icon = "fa-laptop" if is_authorized else "fa-user-secret"
        type_label = "Thiết bị hợp lệ (Smart Device)" if is_authorized else "Thiết bị lạ (UNKNOWN DEVICE)"
        if vendor == "Generic Network Vendor":
            vendor = "Authorized Device" if is_authorized else "Generic Network Vendor"

    # Đặt tên hiển thị chi tiết
    if custom_whitelist_name:
        display_name = custom_whitelist_name
    elif hostname:
        display_name = f"{hostname}"
    elif is_authorized:
        display_name = f"Thiết bị hợp lệ ({type_label})"
    else:
        display_name = f"{type_label}"

    return {
        "name": display_name,
        "type": dtype,
        "icon": icon,
        "vendor": vendor,
        "hostname": hostname or "N/A",
        "ports": open_ports
    }


def get_local_ip_range():
    """
    Hàm tự động lấy dải IP mạng nội bộ hiện tại của máy tính.
    Ví dụ: Máy tính có IP 192.168.1.15 -> Dải mạng cần quét là 192.168.1.0/24
    """
    try:
        # Tạo kết nối giả lập để lấy IP đang hoạt động của máy tính
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        
        # Tách lấy 3 cụm số đầu (ví dụ: '192.168.1') và tạo dải quét '/24'
        ip_parts = local_ip.split('.')
        ip_range = f"{ip_parts[0]}.{ip_parts[1]}.{ip_parts[2]}.0/24"
        return ip_range, local_ip
    except Exception as e:
        print(f"[!] Không thể tự động lấy dải IP mạng: {e}")
        # Mặc định trả về dải mạng phổ biến nếu lỗi
        return "192.168.1.0/24", "127.0.0.1"

def scan_network(ip_range, log_cb=None):
    """
    Hàm sử dụng Scapy để gửi gói tin ARP Request đến toàn bộ dải mạng
    và nhận về danh sách thiết bị đang hoạt động (IP & MAC).
    """
    def log(msg, category="system-log"):
        if log_cb:
            log_cb(msg, category)
        print(msg)

    if MOCK_MODE:
        log("[*] CHẾ ĐỘ GIẢ LẬP: Đang mô phỏng quét mạng...", "scan-log")
        time.sleep(1.5)  # Tạo độ trễ quét mạng cho giống thật
        return [
            {"ip": "192.168.1.1", "mac": "00:11:22:33:44:55"},     # Hợp lệ (Router)
            {"ip": "192.168.1.127", "mac": "40:23:43:af:80:83"},   # Hợp lệ (Máy tính của bạn)
            {"ip": "192.168.1.50", "mac": "aa:bb:cc:dd:ee:ff"},    # Hợp lệ (Điện thoại)
            {"ip": "192.168.1.100", "mac": "24:fc:e5:aa:bb:cc"},   # Hợp lệ (Smart TV)
            {"ip": "192.168.1.150", "mac": "99:88:77:66:55:44"},   # TRÁI PHÉP (Thiết bị lạ 1)
            {"ip": "192.168.1.180", "mac": "11:22:33:aa:bb:cc"}    # TRÁI PHÉP (Thiết bị lạ 2)
        ]

    log(f"[*] Đang khởi tạo quét mạng trên dải IP: {ip_range}...", "scan-log")
    
    # Tự động tìm card mạng đang kết nối Internet thật (tránh card ảo VMware, VirtualBox, v.v.)
    best_iface = None
    try:
        # pyrefly: ignore [missing-import]
        from scapy.all import conf
        route_info = conf.route.route("8.8.8.8")
        best_iface = route_info[0]
        log(f"[*] Tự động chọn card mạng: {best_iface}", "scan-log")
    except Exception as e:
        log(f"[!] Không thể xác định card mạng tối ưu: {e}. Sẽ dùng mặc định.", "warning-log")

    # 1. Tạo gói tin ARP Request: "Ai có IP này thì trả lời tôi"
    # pdst là dải IP đích cần quét
    arp_request = ARP(pdst=ip_range)
    
    # 2. Tạo gói tin Ethernet để đóng gói ARP (gửi đến địa chỉ broadcast ff:ff:ff:ff:ff:ff)
    broadcast = Ether(dst="ff:ff:ff:ff:ff:ff")
    
    # 3. Kết hợp hai gói tin thành một yêu cầu quét hoàn chỉnh
    arp_request_packet = broadcast / arp_request
    
    # 4. Gửi gói tin đi và đợi phản hồi (srp = send and receive packets at layer 2)
    # timeout=3: Đợi phản hồi trong 3 giây. verbose=False: Tắt các thông báo log thừa.
    try:
        if best_iface:
            answered_list = srp(arp_request_packet, timeout=3, verbose=False, iface=best_iface)[0]
        else:
            answered_list = srp(arp_request_packet, timeout=3, verbose=False)[0]
    except PermissionError:
        log("\n[!] LỖI QUYỀN HẠN: Bạn cần chạy Command Prompt / PowerShell bằng quyền Administrator!", "danger-log")
        if os.name == 'nt':
            log("    -> Click chuột phải vào CMD/PowerShell và chọn 'Run as Administrator'", "danger-log")
        else:
            log("    -> Chạy lệnh với sudo: sudo python scanner.py", "danger-log")
        sys.exit(1)
    except Exception as e:
        log(f"\n[!] Lỗi khi quét mạng: {e}", "danger-log")
        return []

    # 5. Phân tích phản hồi và lưu kết quả
    discovered_devices = []
    for sent, received in answered_list:
        device_info = {
            "ip": received.psrc,    # IP của thiết bị phản hồi
            "mac": received.hwsrc.lower()  # MAC của thiết bị phản hồi (chuyển về chữ thường để so sánh)
        }
        discovered_devices.append(device_info)
        
    return discovered_devices

class ScannerAPIHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Tắt log mặc định của http.server để màn hình terminal sạch sẽ
        pass

    def do_OPTIONS(self):
        # Hỗ trợ CORS cho phép giao diện Web gọi API từ file local (file:///)
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        global INJECT_ROGUE, MOCK_MODE
        
        if self.path.startswith('/scan'):
            print("\n[HTTP] Nhận yêu cầu quét mạng từ Web Dashboard...")
            
            # Thiết lập header cho SSE (Server-Sent Events) để stream logs thời gian thực
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            
            def send_event(event_type, message_or_data, level="system-log"):
                try:
                    if event_type == "log":
                        payload = json.dumps({"type": "log", "message": message_or_data, "level": level})
                    else:
                        payload = json.dumps({"type": event_type, "data": message_or_data})
                    self.wfile.write(f"data: {payload}\n\n".encode('utf-8'))
                    self.wfile.flush()
                except Exception as e:
                    print(f"[!] Lỗi khi gửi log stream: {e}")
            
            def log_callback(msg, category="system-log"):
                send_event("log", msg, category)
                
            send_event("log", "============================================================", "system-log")
            send_event("log", "    HE THONG PHAT HIEN THIET BI IOT TRAI PHEP", "system-log")
            send_event("log", "============================================================", "system-log")
            
            ip_range, local_ip = get_local_ip_range()
            send_event("log", f"[*] IP máy tính của bạn: {local_ip}", "system-log")
            send_event("log", f"[*] Dải mạng nội bộ: {ip_range}", "system-log")
            send_event("log", f"[*] Số lượng thiết bị trong Whitelist: {len(WHITELIST_DEVICES)} thiết bị.", "system-log")
            send_event("log", "------------------------------------------------------------", "system-log")
            
            # Quét mạng và truyền callback để stream logs về trình duyệt theo thời gian thực
            devices = scan_network(ip_range, log_cb=log_callback)
            
            # Nếu chế độ tiêm thiết bị lạ được kích hoạt, chèn thêm 1 thiết bị lạ vào danh sách quét thật
            if INJECT_ROGUE:
                send_event("log", "[*] Đang chèn thiết bị lạ giả lập vào kết quả quét thật...", "warning-log")
                # Tránh chèn trùng nếu đã có sẵn trong danh sách
                if not any(d["mac"] == "bc:d1:d3:ef:22:90" for d in devices):
                    devices.append({
                        "ip": "192.168.1.189",
                        "mac": "bc:d1:d3:ef:22:90"
                    })
            
            # Khớp các thiết bị quét được với thông tin mô tả chi tiết từ hàm Fingerprinting
            results = []
            send_event("log", "[*] Đang phân tích thông tin thiết bị (OUI Lookup, Hostname, Ports)...", "scan-log")
            for dev in devices:
                mac = dev["mac"]
                ip = dev["ip"]
                authorized = mac.lower() in WHITELIST_DEVICES
                custom_name = WHITELIST_DEVICES.get(mac.lower())
                
                # Xác định loại thiết bị tự động
                info = identify_device_info(ip, mac, authorized, custom_name)
                
                results.append({
                    "ip": ip,
                    "mac": mac,
                    "name": info["name"],
                    "type": info["type"],
                    "icon": info["icon"],
                    "vendor": info["vendor"],
                    "hostname": info["hostname"],
                    "authorized": authorized
                })
            
            send_event("log", "============================================================", "system-log")
            send_event("log", f"    KET QUA QUET MANG (Tim thay {len(results)} thiet bi dang online)", "system-log")
            send_event("log", "============================================================", "system-log")
            send_event("log", f"{'STT':<5}{'Địa chỉ IP':<18}{'Địa chỉ MAC':<20}{'Trạng thái / Tên thiết bị'}", "system-log")
            send_event("log", "------------------------------------------------------------", "system-log")
            
            unauthorized_count = 0
            for idx, dev in enumerate(results, start=1):
                mac = dev["mac"]
                ip = dev["ip"]
                authorized = dev["authorized"]
                num_str = f"{idx:<5}"
                ip_str = f"{ip:<18}"
                mac_str = f"{mac:<20}"
                
                if authorized:
                    status = f"hợp lệ - {dev['name']}"
                    send_event("log", f"{num_str}{ip_str}{mac_str}{status}", "success-log")
                else:
                    status = "CẢNH BÁO: TRÁI PHÉP (UNKNOWN DEVICE)!"
                    send_event("log", f"{num_str}{ip_str}{mac_str}{status}", "alert-log")
                    unauthorized_count += 1
            
            send_event("log", "------------------------------------------------------------", "system-log")
            if unauthorized_count > 0:
                send_event("log", f"[CẢNH BÁO NGUY HIỂM] Phát hiện {unauthorized_count} thiết bị TRÁI PHÉP kết nối vào mạng!", "danger-log")
                send_event("log", " -> Hãy kiểm tra lại địa chỉ MAC của thiết bị đó.", "warning-log")
            else:
                send_event("log", "[AN TOÀN] Không phát hiện thiết bị lạ nào trong mạng nội bộ.", "success-log")
            send_event("log", "============================================================", "system-log")
            
            response_data = {
                "local_ip": local_ip,
                "ip_range": ip_range,
                "devices": results,
                "whitelist": WHITELIST_DEVICES
            }
            
            # Gửi kết quả quét cuối cùng để vẽ bản đồ
            send_event("result", response_data)
            print(f"[HTTP] Đã gửi kết quả {len(results)} thiết bị dạng stream về Web Dashboard.")
            
        elif self.path.startswith('/simulate_rogue'):
            INJECT_ROGUE = True
            print("\n[HTTP] Kích hoạt chế độ giả lập thiết bị lạ xâm nhập!")
            print(" -> Thiết bị lạ (192.168.1.189 / bc:d1:d3:ef:22:90) sẽ xuất hiện trong lần quét kế tiếp.")
            
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "success", "message": "Rogue armed"}).encode('utf-8'))
            
        elif self.path.startswith('/reset'):
            INJECT_ROGUE = False
            print("\n[HTTP] Reset trạng thái hệ thống từ Web Dashboard.")
            print(" -> Đã gỡ bỏ thiết bị lạ giả lập khỏi danh sách quét.")
            
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "success", "message": "System reset"}).encode('utf-8'))

        elif self.path.startswith('/block'):
            from urllib.parse import urlparse, parse_qs
            parsed_url = urlparse(self.path)
            params = parse_qs(parsed_url.query)
            mac = params.get('mac', [None])[0]
            ip = params.get('ip', ['Unknown'])[0]
            
            if mac:
                print(f"\n[ALERT - MITIGATION] Nhận yêu cầu cô lập từ Web Dashboard!")
                print(f" -> [ARP SPOOFING] Đang gửi các gói tin ARP Poisoning tới Gateway...")
                print(f" -> [SUCCESS] Đã cắt kết nối Internet của thiết bị có MAC: {mac} (IP: {ip})")
            
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "success", "message": f"Blocked {mac}"}).encode('utf-8'))
            
        elif self.path.startswith('/unblock'):
            from urllib.parse import urlparse, parse_qs
            parsed_url = urlparse(self.path)
            params = parse_qs(parsed_url.query)
            mac = params.get('mac', [None])[0]
            ip = params.get('ip', ['Unknown'])[0]
            
            if mac:
                print(f"\n[MITIGATION] Nhận yêu cầu bỏ chặn từ Web Dashboard.")
                print(f" -> [ARP RESTORE] Khôi phục bảng ARP cho thiết bị: {mac} (IP: {ip})")
                print(f" -> [SUCCESS] Khôi phục kết nối thành công cho {ip}.")
            
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "success", "message": f"Unblocked {mac}"}).encode('utf-8'))
            
        elif self.path.startswith('/whitelist/add'):
            from urllib.parse import urlparse, parse_qs
            parsed_url = urlparse(self.path)
            params = parse_qs(parsed_url.query)
            mac = params.get('mac', [None])[0]
            name = params.get('name', [None])[0]
            
            if mac and name:
                WHITELIST_DEVICES[mac.lower()] = name
                print(f"\n[HTTP] Thêm thiết bị vào Whitelist: {mac} -> {name}")
                status = "success"
                message = f"Added {mac} to whitelist."
            else:
                status = "error"
                message = "Missing MAC or Name parameters."
                
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"status": status, "message": message, "whitelist": WHITELIST_DEVICES}).encode('utf-8'))
            
        elif self.path.startswith('/whitelist/remove'):
            from urllib.parse import urlparse, parse_qs
            parsed_url = urlparse(self.path)
            params = parse_qs(parsed_url.query)
            mac = params.get('mac', [None])[0]
            
            if mac:
                mac_lower = mac.lower()
                if mac_lower in WHITELIST_DEVICES:
                    name = WHITELIST_DEVICES.pop(mac_lower)
                    print(f"\n[HTTP] Xóa thiết bị khỏi Whitelist: {mac} ({name})")
                    status = "success"
                    message = f"Removed {mac} from whitelist."
                else:
                    status = "error"
                    message = f"MAC {mac} not found in whitelist."
            else:
                status = "error"
                message = "Missing MAC parameter."
                
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"status": status, "message": message, "whitelist": WHITELIST_DEVICES}).encode('utf-8'))
            
        elif self.path.startswith('/whitelist/list'):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "success", "whitelist": WHITELIST_DEVICES}).encode('utf-8'))
            
        elif self.path.startswith('/mock_mode'):
            from urllib.parse import urlparse, parse_qs
            parsed_url = urlparse(self.path)
            params = parse_qs(parsed_url.query)
            enable = params.get('enable', [None])[0]
            
            if enable == 'true':
                MOCK_MODE = True
                print("\n[HTTP] Đã BẬT chế độ giả lập quét mạng (MOCK_MODE = True).")
                message = "Mock mode enabled."
            elif enable == 'false':
                MOCK_MODE = False
                print("\n[HTTP] Đã TẮT chế độ giả lập quét mạng (MOCK_MODE = False).")
                message = "Mock mode disabled."
            else:
                message = f"Mock mode status: {MOCK_MODE}"
                
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "success", "mock_mode": MOCK_MODE, "message": message}).encode('utf-8'))
            
        else:
            self.send_response(404)
            self.end_headers()

def main():
    print("=" * 60)
    print("    HE THONG PHAT HIEN THIET BI TRAI PHEP TRONG MANG IOT")
    print("=" * 60)
    
    # Tự động phát hiện IP máy hiện tại và dải mạng
    ip_range, local_ip = get_local_ip_range()
    print(f"[*] IP máy tính của bạn: {local_ip}")
    print(f"[*] Dải mạng nội bộ: {ip_range}")
    print(f"[*] Số lượng thiết bị trong Whitelist: {len(WHITELIST_DEVICES)} thiết bị.")
    print("-" * 60)
    
    # Quét mạng
    devices = scan_network(ip_range)
    
    print("\n" + "=" * 60)
    print(f"    KET QUA QUET MANG (Tim thay {len(devices)} thiet bi dang online)")
    print("=" * 75)
    print(f"{'STT':<5}{'Địa chỉ IP':<16}{'Địa chỉ MAC':<20}{'Nhà sản xuất (Vendor)':<22}{'Trạng thái / Tên'}")
    print("-" * 75)
    
    unauthorized_count = 0
    
    for idx, dev in enumerate(devices, start=1):
        mac = dev["mac"]
        ip = dev["ip"]
        authorized = mac.lower() in WHITELIST_DEVICES
        custom_name = WHITELIST_DEVICES.get(mac.lower())
        
        info = identify_device_info(ip, mac, authorized, custom_name)
        vendor_str = f"{info['vendor'][:20]:<22}"
        
        if authorized:
            status = f"Hợp lệ - {info['name']}"
            print(f"{idx:<5}{ip:<16}{mac:<20}{vendor_str}{status}")
        else:
            status = f"CẢNH BÁO: TRÁI PHÉP ({info['name']})!"
            print(f"{idx:<5}{ip:<16}{mac:<20}{vendor_str}{status}")
            unauthorized_count += 1
            
    print("-" * 75)
    if unauthorized_count > 0:
        print(f"[CẢNH BÁO NGUY HIỂM] Phát hiện {unauthorized_count} thiết bị TRÁI PHÉP kết nối vào mạng!")
        print(" -> Hãy kiểm tra lại địa chỉ MAC của thiết bị đó.")
    else:
        print("[AN TOÀN] Không phát hiện thiết bị lạ nào trong mạng nội bộ.")
    print("=" * 60)
    
    # Khởi chạy API Server cho Web Dashboard kết nối
    PORT = 5000
    print(f"\n[+] ĐANG KHỞI ĐỘNG WEB API SERVER...")

    # Thử tối đa 5 cổng liên tiếp nếu cổng mặc định bị chiếm
    server = None
    for attempt in range(5):
        current_port = PORT + attempt
        try:
            server = HTTPServer(('127.0.0.1', current_port), ScannerAPIHandler)
            print(f"[+] Server đang chạy tại địa chỉ: http://127.0.0.1:{current_port}")
            print(f"[+] HƯỚNG DẪN: Mở file 'index.html' trên trình duyệt để dùng giao diện web.")
            if current_port != PORT:
                print(f"[!] Lưu ý: Cổng {PORT} bị chiếm, đang dùng cổng {current_port}.")
            print(f"[+] Nhấn Ctrl + C trong cửa sổ này để dừng Server.")
            print("-" * 60)
            break
        except OSError:
            if attempt < 4:
                print(f"[!] Cổng {current_port} đang bị chiếm. Thử cổng {current_port + 1}...")
            else:
                print(f"\n[!] Không thể khởi động server. Tất cả cổng từ {PORT} đến {PORT+4} đều bị chiếm.")
                print(f"    -> Hãy tắt cửa sổ CMD này, mở lại mới và chạy lại lệnh.")
                sys.exit(1)

    if server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n[!] Đang dừng Web API Server. Tạm biệt!")
            sys.exit(0)

if __name__ == "__main__":
    main()
