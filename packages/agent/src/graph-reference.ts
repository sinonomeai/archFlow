export const GRAPH_REFERENCE_QUESTION =
  "请在聊天记录里找到对应的架构图，在那条消息下点击「用这张图提问」，再发送回复。";

export const GRAPH_REFERENCE_READ_ONLY_MESSAGE =
  "历史图只支持单独查看和解释。要查看或修改当前画布，请移除引用后重新发送。";

const HISTORICAL_GRAPH =
  /(?:历史|之前|原先|刚才|上面|上文|前面|上(?:一)?次|前(?:一)?次|昨天)(?:的?那[张幅]|的|消息中的|记录中的)?(?:架构图|系统图|画布|草稿|图)|\b(?:previous|earlier|old|older|saved|historical|first|original)\s+(?:architecture\s+)?(?:diagram|graph|canvas|draft)\b/iu;

const DISTAL_GRAPH_READ_ZH =
  /^\s*(?:(?:请(?:帮我)?|帮我|能否|可以)\s*)?(?:解释|说明|解读|看看|查看|讲讲)(?:一下)?\s*那(?:一?[张幅份]|个)\s*(?:架构图|系统图|画布|草稿|图(?![片标表像]))/u;
const DISTAL_GRAPH_READ_EN =
  /^\s*(?:(?:please|(?:can|could|would)\s+you(?:\s+please)?)\s+)?(?:explain|review|show(?:\s+me)?|describe)\s+that\s+(?:architecture\s+)?(?:diagram|graph|canvas|draft)\b/iu;

const GRAPH_VERSION =
  /第\s*[零〇一二两三四五六七八九十百\d]+\s*(?:个|张|幅)?\s*(?:版|图|画布)|上(?:上|一|一个|个)?版|前[一几]?版|初版|(?:旧|老|前|历史)版本?|最初的?版本?|\b(?:previous|earlier|old|older|first|original)\s+version\b/iu;

const JUST_GENERATED_GRAPH =
  /刚(?:刚|才)(?:生成|绘制|画)(?:的)?(?:架构图|系统图|画布|图)/u;
const CREATE_GRAPH =
  /(?:生成|创建|绘制|画)[^。？！]{0,30}(?:架构图|一[张幅]图|画布)/u;

const CREATE_VERSION =
  /(?:生成|创建|绘制|画|\b(?:create|draw|generate|design)\b)(?:\s+|一个|一张|一幅|一份|全新(?:的)?|新(?:的)?|\ban?\b|\bnew\b|\bthe\b)*$/iu;

const NUMBERED_VERSION = /\b(?:v\d+|ver(?:sion)?\s*\d+)\b/iu;
const GRAPH_BEFORE_VERSION =
  /(?:架构图|系统图|画布|草稿|\b(?:diagram|graph|canvas|draft))\s*(?:的\s*|[:：-]\s*)?$/iu;
const GRAPH_AFTER_VERSION =
  /^\s*(?:的\s*)?(?:架构图|系统图|画布|草稿|(?:architecture\s+)?(?:diagram|graph|canvas|draft)\b)/iu;
const STANDALONE_VERSION_QUERY =
  /^\s*(?:(?:请|帮我)?(?:解释|说明|解读|看看|查看|讲讲)(?:一下)?|(?:please\s+)?(?:explain|review|show|describe))?\s*$/iu;

export const isHistoricalGraphRequest = (input: string): boolean => {
  const text = input.normalize("NFKC");
  if (
    HISTORICAL_GRAPH.test(text) ||
    DISTAL_GRAPH_READ_ZH.test(text) ||
    DISTAL_GRAPH_READ_EN.test(text)
  )
    return true;
  const generated = JUST_GENERATED_GRAPH.exec(text);
  if (generated && !CREATE_GRAPH.test(text.slice(0, generated.index)))
    return true;

  const graphVersion = GRAPH_VERSION.exec(text);
  if (graphVersion)
    return !CREATE_VERSION.test(text.slice(0, graphVersion.index));

  const numbered = NUMBERED_VERSION.exec(text);
  if (!numbered) return false;
  const beforeVersion = text.slice(0, numbered.index);
  const afterVersion = text.slice(numbered.index + numbered[0].length);
  return (
    !CREATE_VERSION.test(beforeVersion) &&
    (GRAPH_BEFORE_VERSION.test(beforeVersion) ||
      GRAPH_AFTER_VERSION.test(afterVersion) ||
      (STANDALONE_VERSION_QUERY.test(beforeVersion) &&
        /^[\s。.!?？]*$/u.test(afterVersion)))
  );
};

export const isCurrentGraphRequest = (input: string): boolean => {
  const text = input.normalize("NFKC");
  return (
    /(?:当前|现在|目前)(?:的|这[张幅个])?(?:架构图|系统图|画布|草稿|图)|\b(?:current|live)\s+(?:(?:architecture|working)\s+)?(?:diagram|graph|canvas|draft)\b/iu.test(
      text,
    ) ||
    (isHistoricalGraphRequest(text) &&
      /(?:[和与跟比对]当前|当前(?:的)?(?:区别|差异|差别|相比))|\b(?:with|versus|vs\.?|and)\s+(?:the\s+)?current\b/iu.test(
        text,
      ))
  );
};
