# Hướng Dẫn Đề Tài: Phát Hiện Thiết Bị Trái Phép Trong Mạng IoT Nội Bộ

Chào mừng bạn đến với đề tài **"Phát hiện thiết bị trái phép trong mạng IoT nội bộ"** (Internal IoT Rogue Device Detection). Đây là một đề tài thực tế, mang tính ứng dụng cao và cực kỳ phù hợp cho người mới bắt đầu tìm hiểu về An ninh mạng (Cybersecurity) và Internet vạn vật (IoT).

Tài liệu này sẽ hướng dẫn bạn từ con số 0 để hiểu và vận hành hệ thống mô phỏng cũng như quét mạng thực tế.

---

## 1. Kiến Thức Cơ Bản Cho Người Mới Bắt Đầu

Để làm được đề tài này, bạn cần hiểu 4 khái niệm mạng cơ bản sau:

### A. Địa chỉ IP (Internet Protocol)
* **Khái niệm**: Là địa chỉ số của thiết bị trong mạng (như địa chỉ nhà tạm thời). Trong mạng nội bộ (mạng Wi-Fi nhà bạn), địa chỉ IP thường có dạng `192.168.1.X` (ví dụ: `192.168.1.5`).
* **Đặc điểm**: Địa chỉ IP có thể thay đổi mỗi khi thiết bị ngắt kết nối và kết nối lại (IP động).

### B. Địa chỉ MAC (Media Access Control)
* **Khái niệm**: Là địa chỉ vật lý duy nhất của thiết bị mạng, được nhà sản xuất ghi đè cứng vào phần cứng (như số căn cước công dân). Định dạng: `00:1A:2B:3C:4D:5E`.
* **Đặc điểm**: **Không thay đổi** và duy nhất trên toàn thế giới. Đây là cơ sở chính xác nhất để chúng ta định danh một thiết bị IoT trong nhà.

### C. Giao thức ARP (Address Resolution Protocol)
* **Khái niệm**: Là giao thức giúp các thiết bị trong mạng tìm địa chỉ MAC của nhau dựa trên địa chỉ IP.
* **Cách hoạt động**: Thiết bị quét sẽ gửi một gói tin hỏi cả mạng (Broadcast): *"Ai có địa chỉ IP `192.168.1.X` thì trả lời cho tôi biết địa chỉ MAC của bạn!"*. Thiết bị đang online sở hữu IP đó sẽ phản hồi lại địa chỉ MAC của mình.

### D. Danh sách thiết bị hợp lệ (Whitelist)
* Là danh sách các địa chỉ MAC của những thiết bị thuộc sở hữu của bạn (điện thoại, laptop, camera gia đình, bóng đèn thông minh).
* **Nguyên lý phát hiện**:
  $$\text{Quét Mạng} \rightarrow \text{Tìm ra các MAC đang hoạt động} \rightarrow \text{So khớp với Whitelist} \rightarrow \text{Nếu MAC không có trong Whitelist} \rightarrow \text{CẢNH BÁO THIẾT BỊ TRÁI PHÉP}$$

---

## 2. Cấu Trúc Thư Mục Dự Án

Thư mục dự án bao gồm các file sau:
* [README.md](file:///d:/iot/README.md): Tài liệu hướng dẫn này.
* [scanner.py](file:///d:/iot/scanner.py): Script Python dùng để quét mạng thực tế bằng giao thức ARP.
* [index.html](file:///d:/iot/index.html): Giao diện Dashboard mô phỏng trực quan.
* [style.css](file:///d:/iot/style.css): Giao diện CSS hiện đại cho Dashboard.
* [app.js](file:///d:/iot/app.js): Logic mô phỏng các hoạt động mạng và phát hiện xâm nhập.

---

## 3. Cách Vận Hành Dự Án

### Bước 1: Trải nghiệm Dashboard Mô Phỏng (Dành cho việc demo/thuyết trình)
1. Bạn chỉ cần click đúp vào file [index.html](file:///d:/iot/index.html) để mở nó trực tiếp bằng trình duyệt Chrome, Edge hoặc Firefox.
2. Trên giao diện, bấm **"Bắt đầu Quét Hệ Thống"**. Bạn sẽ thấy quá trình quét mạng giả lập diễn ra, các thiết bị hợp lệ hiển thị màu xanh và khi có một thiết bị lạ (ví dụ: máy của hacker) kết nối vào, hệ thống sẽ nhấp nháy đỏ và đưa ra cảnh báo.

### Bước 2: Chạy công cụ quét mạng thực tế bằng Python
Để chạy được file [scanner.py](file:///d:/iot/scanner.py) trên mạng Wi-Fi thực tế của nhà bạn, hãy làm theo các bước sau:

#### A. Cài đặt Python:
1. Tải và cài đặt Python từ trang chủ [python.org](https://www.python.org/). (Nhớ tích chọn vào ô **"Add Python to PATH"** khi cài đặt).

#### B. Cài đặt thư viện Scapy (dùng để gửi/nhận gói tin mạng):
Mở Command Prompt (CMD) hoặc PowerShell của Windows và chạy lệnh sau:
```bash
pip install scapy
```

#### C. Chạy Script Quét Mạng:
Do việc gửi gói tin ARP trực tiếp yêu cầu quyền hạn cao của hệ điều hành, bạn cần chạy script dưới quyền **Administrator**:
1. Tìm kiếm `cmd` hoặc `PowerShell` trong menu Start của Windows.
2. Click chuột phải chọn **"Run as Administrator"** (Chạy dưới quyền quản trị viên).
3. Di chuyển đến thư mục chứa dự án và chạy:
   ```bash
   python scanner.py
   ```
4. Giao diện dòng lệnh sẽ hiển thị danh sách thiết bị đang online trong nhà bạn và đưa ra cảnh báo nếu phát hiện thiết bị lạ không nằm trong whitelist cấu hình sẵn ở đầu file Python.

---

## 4. Định Hướng Phát Triển Cho Đề Tài Báo Cáo

Nếu bạn muốn đề tài của mình đạt điểm cao hoặc chuyên nghiệp hơn, hãy phát triển thêm các tính năng sau:

1. **Gửi cảnh báo qua Telegram/Email**:
   * Khi phát hiện thiết bị lạ, script Python sẽ tự động gọi API của Telegram để gửi tin nhắn cảnh báo trực tiếp về điện thoại của bạn.
2. **Chặn kết nối (Ngắt mạng thiết bị lạ)**:
   * Sử dụng kỹ thuật **ARP Spoofing** (Giả mạo ARP) để gửi gói tin cấu hình sai tới thiết bị trái phép, khiến nó bị ngắt kết nối Internet hoàn toàn.
3. **Phân loại thiết bị tự động (Device Fingerprinting)**:
   * Quét các cổng dịch vụ mở (Port Scan) của thiết bị lạ (ví dụ: cổng 80 là Web, cổng 554 là Camera RTSP). Dựa vào các cổng này để đoán loại thiết bị đó là gì (Camera, máy tính hay máy in).
4. **Lưu trữ lịch sử quét**:
   * Sử dụng cơ sở dữ liệu nhỏ như SQLite để lưu trữ lịch sử các thiết bị ra/vào mạng để vẽ biểu đồ thống kê.
