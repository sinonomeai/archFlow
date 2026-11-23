"use client";

import {
  ChevronDown,
  Download,
  FileJson,
  Image as ImageIcon,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const EXPORT_ITEMS = [
  { icon: Save, label: "保存为项目资产" },
  { icon: FileJson, label: "导出为 JSON" },
  { icon: ImageIcon, label: "导出为 PNG 图片" },
];

type ExportMenuProps = {
  defaultOpen?: boolean;
};

export const ExportMenu = ({ defaultOpen = false }: ExportMenuProps) => (
  <DropdownMenu defaultOpen={defaultOpen}>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" size="sm" className="group">
        <Download className="size-3.5" strokeWidth={1.75} />
        导出
        <ChevronDown
          className="size-3 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
          strokeWidth={1.75}
        />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" sideOffset={6} className="w-52">
      {EXPORT_ITEMS.map(({ icon: Icon, label }) => (
        <DropdownMenuItem key={label} className="px-2.5 py-2 text-xs">
          <Icon className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
          {label}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);
