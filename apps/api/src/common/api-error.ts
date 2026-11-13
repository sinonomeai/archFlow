import { HttpException, type HttpStatus } from "@nestjs/common";
import type { FieldError } from "@arch-flow/shared";

/**
 * 业务异常：响应体由全局过滤器统一转成 ApiResponse 外壳。
 * 所有业务错误都必须带 code，禁止只抛裸字符串。
 */
export class ApiException extends HttpException {
  constructor(
    status: HttpStatus,
    code: string,
    message: string,
    errors?: FieldError[],
    data?: unknown,
  ) {
    super(
      {
        code,
        message,
        ...(errors ? { errors } : {}),
        ...(data !== undefined ? { data } : {}),
      },
      status,
    );
  }
}

export const apiError = (
  status: HttpStatus,
  code: string,
  message: string,
  errors?: FieldError[],
  data?: unknown,
): ApiException => new ApiException(status, code, message, errors, data);
