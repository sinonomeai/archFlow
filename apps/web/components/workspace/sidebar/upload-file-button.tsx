"use client";

import { useRef, type ChangeEvent } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useUploadFile } from "@/hooks/use-upload-file";
import {
  MAX_FILE_SIZE_BYTES,
  SUPPORTED_FILE_ACCEPT,
  resolveFileType,
} from "@/lib/file-types";

export const UploadFileButton = ({ projectId }: { projectId: string }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadFile = useUploadFile();

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    /** 清空 value，保证连续选择同一个文件也能触发 change。 */
    event.target.value = "";

    if (!file) {
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast.error("单个文件不能超过 20MB");
      return;
    }

    if (!resolveFileType(file.name)) {
      toast.error(`不支持的文件类型，仅支持 ${SUPPORTED_FILE_ACCEPT}`);
      return;
    }

    uploadFile.mutate({ projectId, file });
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={SUPPORTED_FILE_ACCEPT}
        className="hidden"
        disabled={uploadFile.isPending}
        onChange={handleChange}
      />
      <button
        type="button"
        aria-label="上传文档"
        title="上传文档"
        disabled={uploadFile.isPending}
        onClick={() => inputRef.current?.click()}
        className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        {uploadFile.isPending ? (
          <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
        ) : (
          <Plus className="size-3.5" strokeWidth={1.75} />
        )}
      </button>
    </>
  );
};
