# Emit owner-typed text from a Claude Code session JSONL: one {ts, text} per user turn.
# Run only through dream-extract.sh (the dream-extract wrapper on PATH).
# Reads only lines from+1..to, so a line appended after the line-count snapshot is never parsed.
# Exits nonzero on a line that isn't JSON, a user line without a timestamp, or an
# unexpected message.content shape; the caller treats that as a parse_error.
def strip_tags:
  gsub("<(?<t>system-reminder|command-[a-z-]+|local-command-[a-z-]+|pasted_content|cross-session-message|task-notification)[^>]*>[\\s\\S]*?</\\k<t>[^>]*>"; "");
def epoch: sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601;
foreach limit($to; inputs) as $line (0; . + 1; select(. > $from) | $line)
| select(.type == "user" and (.isMeta // false) == false)
| (.timestamp // error("user line without timestamp")) as $ts
| select($after == "" or (($ts | epoch) > ($after | epoch)))
| (.message.content
   | if type == "string" then .
     elif type == "array" then [ .[] | select(.type == "text") | .text ] | join("\n")
     else error("message.content is neither string nor array") end
   | strip_tags | gsub("^\\s+|\\s+$"; "")) as $text
| select($text != "")
| {ts: $ts, text: $text}
