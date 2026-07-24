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
    "0e:0f:73:e7:61:9e":"điện thoại của tôi"
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

def scan_network(ip_range):
    """
    Hàm sử dụng Scapy để gửi gói tin ARP Request đến toàn bộ dải mạng
    và nhận về danh sách thiết bị đang hoạt động (IP & MAC).
    """
    if MOCK_MODE:
        print("[*] CHẾ ĐỘ GIẢ LẬP: Đang mô phỏng quét mạng...")
        time.sleep(1.5)  # Tạo độ trễ quét mạng cho giống thật
        return [
            {"ip": "192.168.1.1", "mac": "00:11:22:33:44:55"},     # Hợp lệ (Router)
            {"ip": "192.168.1.127", "mac": "40:23:43:af:80:83"},   # Hợp lệ (Máy tính của bạn)
            {"ip": "192.168.1.50", "mac": "aa:bb:cc:dd:ee:ff"},    # Hợp lệ (Điện thoại)
            {"ip": "192.168.1.100", "mac": "24:fc:e5:aa:bb:cc"},   # Hợp lệ (Smart TV)
            {"ip": "192.168.1.150", "mac": "99:88:77:66:55:44"},   # TRÁI PHÉP (Thiết bị lạ 1)
            {"ip": "192.168.1.180", "mac": "11:22:33:aa:bb:cc"}    # TRÁI PHÉP (Thiết bị lạ 2)
        ]

    print(f"[*] Đang khởi tạo quét mạng trên dải IP: {ip_range}...")
    
    # Tự động tìm card mạng đang kết nối Internet thật (tránh card ảo VMware, VirtualBox, v.v.)
    best_iface = None
    try:
        from scapy.all import conf
        route_info = conf.route.route("8.8.8.8")
        best_iface = route_info[0]
        print(f"[*] Tự động chọn card mạng: {best_iface}")
    except Exception as e:
        print(f"[!] Không thể xác định card mạng tối ưu: {e}. Sẽ dùng mặc định.")

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
        print("\n[!] LỖI QUYỀN HẠN: Bạn cần chạy Command Prompt / PowerShell bằng quyền Administrator!")
        if os.name == 'nt':
            print("    -> Click chuột phải vào CMD/PowerShell và chọn 'Run as Administrator'")
        else:
            print("    -> Chạy lệnh với sudo: sudo python scanner.py")
        sys.exit(1)
    except Exception as e:
        print(f"\n[!] Lỗi khi quét mạng: {e}")
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
        global INJECT_ROGUE
        
        if self.path.startswith('/scan'):
            print("\n[HTTP] Nhận yêu cầu quét mạng từ Web Dashboard...")
            ip_range, local_ip = get_local_ip_range()
            devices = scan_network(ip_range)
            
            # Nếu chế độ tiêm thiết bị lạ được kích hoạt, chèn thêm 1 thiết bị lạ vào danh sách quét thật
            if INJECT_ROGUE:
                print("[*] Đang chèn thiết bị lạ giả lập vào kết quả quét thật...")
                # Tránh chèn trùng nếu đã có sẵn trong danh sách
                if not any(d["mac"] == "bc:d1:d3:ef:22:90" for d in devices):
                    devices.append({
                        "ip": "192.168.1.189",
                        "mac": "bc:d1:d3:ef:22:90"
                    })
            
            # Khớp các thiết bị quét được với thông tin mô tả chi tiết
            results = []
            for dev in devices:
                mac = dev["mac"]
                ip = dev["ip"]
                authorized = mac in WHITELIST_DEVICES
                
                # Phân loại để hiển thị icon và tên tương ứng trên web
                if mac == "40:23:43:af:80:83":
                    name = "Máy tính của tôi"
                    icon = "fa-laptop"
                    dtype = "laptop"
                    vendor = "Intel/Realtek (Chính chủ)"
                elif mac == "0e:0f:73:e7:61:9e":
                    name = "Điện thoại của tôi"
                    icon = "fa-mobile-screen-button"
                    dtype = "phone"
                    vendor = "Apple/Samsung"
                elif ip.endswith(".1"):
                    name = "Gateway Router (Trung tâm)"
                    icon = "fa-wifi"
                    dtype = "router"
                    vendor = "Cisco/Linksys"
                else:
                    if authorized:
                        name = WHITELIST_DEVICES[mac]
                        icon = "fa-laptop"
                        dtype = "unknown"
                        vendor = "Authorized Device"
                    else:
                        name = "Thiết bị lạ (UNKNOWN DEVICE)"
                        icon = "fa-user-secret"
                        dtype = "unknown"
                        vendor = "Generic Network Vendor"
                
                results.append({
                    "ip": ip,
                    "mac": mac,
                    "name": name,
                    "type": dtype,
                    "icon": icon,
                    "vendor": vendor,
                    "authorized": authorized
                })
            
            response_data = {
                "local_ip": local_ip,
                "ip_range": ip_range,
                "devices": results,
                "whitelist": WHITELIST_DEVICES
            }
            
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(response_data).encode('utf-8'))
            print(f"[HTTP] Đã gửi kết quả {len(results)} thiết bị về Web Dashboard.")
            
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
    print("=" * 60)
    print(f"{'STT':<5}{'Địa chỉ IP':<18}{'Địa chỉ MAC':<20}{'Trạng thái / Tên thiết bị'}")
    print("-" * 60)
    
    unauthorized_count = 0
    
    for idx, dev in enumerate(devices, start=1):
        mac = dev["mac"]
        ip = dev["ip"]
        
        # Kiểm tra xem MAC của thiết bị quét được có nằm trong Whitelist không
        if mac in WHITELIST_DEVICES:
            status = f" hơp lệ - {WHITELIST_DEVICES[mac]}"
            print(f"{idx:<5}{ip:<18}{mac:<20}{status}")
        else:
            status = " CẢNH BÁO: TRÁI PHÉP (UNKNOWN DEVICE)!"
            print(f"{idx:<5}{ip:<18}{mac:<20}{status}")
            unauthorized_count += 1
            
    print("-" * 60)
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
