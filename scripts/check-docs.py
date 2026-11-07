"""核对受 Git 管理文档的定位、相对链接和当前入口中的过期事实。"""
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    policy = json.loads((ROOT / 'docs/document-policy.json').read_text(encoding='utf-8'))
    tracked = set(subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '--', '*.md'], cwd=ROOT, text=True).splitlines())
    errors = []
    if tracked != set(policy):
        errors.append(f'文档定位清单未同步：{sorted(tracked ^ set(policy))}')
    for name, category in policy.items():
        path = ROOT / name
        if not path.is_file():
            errors.append(f'文档缺失：{name}')
            continue
        content = path.read_text(encoding='utf-8')
        if category not in {'current', 'historical', 'design'}:
            errors.append(f'非法文档分类：{name}')
        if category != 'current' and '文档定位：' not in '\n'.join(content.splitlines()[:8]):
            errors.append(f'缺少历史/设计定位提示：{name}')
        # 只检查实际 Markdown 链接，忽略代码块里的示例。
        prose = re.sub(r'```.*?```', '', content, flags=re.S)
        for target in re.findall(r'\]\(([^)]+)\)', prose):
            target = target.strip().split(' "')[0].strip('<>')
            if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target) or target.startswith('#'):
                continue
            relative = unquote(target.split('#')[0])
            if relative and not (path.parent / relative).exists():
                errors.append(f'失效相对链接：{name} → {target}')
    readme = (ROOT / 'README.md').read_text(encoding='utf-8')
    if '属于后续计划，未作为已完成能力交付' in readme:
        errors.append('README 仍错误地把已交付迁移管线标为未来计划。')
    for name in ['docs/LabelHub_Delivery_Runbook.md', 'docs/deployment.md', 'submission/README.md']:
        content = (ROOT / name).read_text(encoding='utf-8')
        if re.search(r'47 路径|39 路径|375 个测试|264 passed|共 6 个场景|9 个 Playwright', content):
            errors.append(f'当前入口残留旧测试/接口数量：{name}')
    for name in ['README.md','apps/api/README.md','docs/LabelHub_Delivery_Runbook.md','docs/deployment.md','docs/OBSERVABILITY.md','submission/README.md']:
        if re.search(r'docker compose[^\n`]*(?:\bbuild\b|\bup\b|\brun\b)', (ROOT/name).read_text(encoding='utf-8')):
            errors.append(f'当前写入命令绕过容量保护：{name}')
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        return 1
    print(f'{len(policy)} 份文档定位、相对链接及关键状态一致性检查通过。')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
