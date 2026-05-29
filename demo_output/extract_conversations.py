import sys, io, json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ldb_path = r'C:\Users\qjh36\AppData\Roaming\novel-writing-app\Local Storage\leveldb\001095.ldb'
with open(ldb_path, 'rb') as f:
    data = f.read()

# Look for UTF-16LE encoded JSON: '[' \x00 '{' \x00 '"' \x00 'i' \x00 'd' \x00 '"' \x00
target = b'[\x00{\x00"\x00i\x00d\x00"\x00'
idx = 0
while True:
    idx = data.find(target, idx)
    if idx < 0:
        break
    print(f'Found potential JSON array at byte {idx}')

    # Try to decode and find matching bracket
    for size in [500, 1000, 2000, 5000, 10000, 20000, 50000, 100000]:
        try:
            chunk = data[idx:idx + size * 2]
            s = chunk.decode('utf-16-le')

            # Find matching brackets for JSON array
            depth = 0
            in_str = False
            escaped = False
            end_pos = 0
            in_start = True
            for i, ch in enumerate(s):
                if ch == '[':
                    depth += 1
                    in_start = False
                elif ch == ']':
                    depth -= 1
                elif ch == '"' and not escaped:
                    in_str = not in_str
                elif ch == '\\' and not escaped:
                    escaped = True
                    continue
                escaped = False
                if not in_start and depth == 0 and not in_str:
                    end_pos = i + 1
                    break

            if end_pos > 0 and s.startswith('[{"id"'):
                json_str = s[:end_pos]
                try:
                    convs = json.loads(json_str)
                    print(f'  Valid JSON! {len(convs)} conversations, {len(s)} chars')

                    out_path = r'D:\3\novel-writing-app\demo_output\conversations.json'
                    with open(out_path, 'w', encoding='utf-8') as f:
                        f.write(json_str)
                    print(f'  Written to demo_output/conversations.json')

                    for ci, c in enumerate(convs):
                        msgs = c.get('messages', [])
                        title = c.get('title', '?')[:60]
                        print(f'  [{ci}] {title} | {len(msgs)} messages')

                    if convs:
                        last = convs[-1]
                        msgs = last.get('messages', [])
                        print(f'\nLast conversation ({last.get("id")}):')
                        for mi, m in enumerate(msgs[-5:]):
                            role = m.get('role', '?')
                            content = str(m.get('content', ''))[:200]
                            print(f'  [{role}]: {content}')

                    sys.exit(0)
                except Exception as e:
                    print(f'  JSON parse failed: {e}')
        except Exception as e:
            print(f'  Decode failed: {e}')
    idx += 1
