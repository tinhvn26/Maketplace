export interface ApiFailure {
  ok: false;
  /** 0 when the API could not be reached. */
  status: number;
  /** Validation messages from the API DTOs (already Vietnamese); null for single business errors. */
  validation: string[] | null;
  retryAfter: number | null;
}

export type ErrorContext = "login" | "register" | "currentPassword" | "otp" | "token" | "email" | "generic";

export function errorMessage(failure: ApiFailure, context: ErrorContext = "generic"): string {
  switch (failure.status) {
    case 0:
      return "Không kết nối được máy chủ, vui lòng thử lại.";
    case 429:
      return `Bạn thử quá nhiều lần, thử lại sau ${failure.retryAfter ?? 60} giây.`;
    case 401:
      if (context === "login") return "Email hoặc mật khẩu không đúng.";
      if (context === "currentPassword" || context === "email") return "Mật khẩu hiện tại không đúng.";
      return "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.";
    case 403:
      return "Bạn không có quyền thực hiện thao tác này.";
    case 409:
      if (context === "register" || context === "email") return "Email đã được sử dụng.";
      return "Dữ liệu vừa được thay đổi ở nơi khác, vui lòng tải lại trang.";
    case 400:
      if (failure.validation?.length) return failure.validation[0];
      if (context === "otp") return "Mã không đúng hoặc đã hết hạn.";
      if (context === "token") return "Liên kết không hợp lệ hoặc đã hết hạn.";
      if (context === "email") return "Email mới không hợp lệ hoặc trùng email hiện tại.";
      return "Thông tin chưa hợp lệ, vui lòng kiểm tra lại.";
    default:
      return "Có lỗi, vui lòng thử lại.";
  }
}
