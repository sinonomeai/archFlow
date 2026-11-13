"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ProjectNode } from "@arch-flow/shared";
import {
  useDeleteAsset,
  useDeleteFile,
  useDeleteProject,
} from "@/hooks/use-delete-project-items";
import { useCreateConversation } from "@/hooks/use-create-conversation";
import { CollapsibleSection } from "./collapsible-section";
import { ConversationLink } from "./conversation-link";
import { ItemActionsMenu } from "./item-actions-menu";
import { NewConversationButton } from "./new-conversation-button";
import { UploadFileButton } from "./upload-file-button";

type SectionItemProps = {
  label: string;
  onDelete: () => void;
  onOpen?: () => void;
};

const SectionItem = ({ label, onDelete, onOpen }: SectionItemProps) => (
  <div className="group/item flex h-7 items-center rounded-md pl-8 pr-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      className="min-w-0 flex-1 truncate text-left disabled:cursor-default"
    >
      {label}
    </button>
    <ItemActionsMenu itemName={label} onDelete={onDelete} />
  </div>
);

export const ProjectGroup = ({ project }: { project: ProjectNode }) => {
  const [open, setOpen] = useState(true);
  const searchParams = useSearchParams();
  const activeConversationId = searchParams.get("conversationId");
  const deleteProject = useDeleteProject();
  const deleteFile = useDeleteFile();
  const deleteAsset = useDeleteAsset();
  const createConversation = useCreateConversation();
  const Chevron = open ? ChevronDown : ChevronRight;

  const handleDeleteProject = () => {
    deleteProject.mutate({
      projectId: project.id,
      name: project.name,
      isActive: project.conversations.some(
        (conversation) => conversation.id === activeConversationId,
      ),
    });
  };

  return (
    <div className="space-y-0.5">
      <div className="flex h-8 items-center rounded-md pl-1.5 pr-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-left"
        >
          <span className="truncate">{project.name}</span>
          <Chevron className="size-3.5 shrink-0" strokeWidth={1.75} />
        </button>
        <ItemActionsMenu
          itemName={project.name}
          alwaysVisible
          onDelete={handleDeleteProject}
        />
      </div>

      {open && (
        <div className="space-y-1">
          <CollapsibleSection kind="assets" label="资产库">
            {project.assets.map((asset) => (
              <SectionItem
                key={asset.id}
                label={asset.name}
                onOpen={() =>
                  createConversation.mutate({
                    projectId: project.id,
                    initialAssetId: asset.id,
                  })
                }
                onDelete={() =>
                  deleteAsset.mutate({
                    projectId: project.id,
                    assetId: asset.id,
                    name: asset.name,
                  })
                }
              />
            ))}
          </CollapsibleSection>

          <CollapsibleSection
            kind="knowledge"
            label="知识库"
            action={<UploadFileButton projectId={project.id} />}
          >
            {project.files.map((file) => (
              <SectionItem
                key={file.id}
                label={file.fileName}
                onDelete={() =>
                  deleteFile.mutate({
                    projectId: project.id,
                    fileId: file.id,
                    name: file.fileName,
                  })
                }
              />
            ))}
          </CollapsibleSection>

          <CollapsibleSection
            kind="conversations"
            label="历史会话"
            action={<NewConversationButton projectId={project.id} />}
          >
            {project.conversations.map((conversation) => (
              <ConversationLink
                key={conversation.id}
                projectId={project.id}
                conversationId={conversation.id}
                title={conversation.title}
              />
            ))}
          </CollapsibleSection>
        </div>
      )}
    </div>
  );
};
