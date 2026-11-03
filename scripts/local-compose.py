"""为常用 Compose 写入操作提供容量预检与执行中保护。"""
import subprocess
import sys
from storage_guard import StorageError, guarded_run, preflight

# 只允许明确识别的操作；避免未知参数把写入命令误判为只读。
READ_ONLY = {'config', 'ps', 'ls', 'logs', 'images', 'top', 'port', 'version', 'help'}
RECOVERY = {'stop', 'down', 'rm', 'kill', 'pause', 'unpause'}
WRITE = {'build', 'up', 'run', 'pull', 'start', 'restart', 'create', 'exec', 'cp', 'watch'}
VALUE_OPTIONS = {'-f', '--file', '-p', '--project-name', '--project-directory', '--env-file', '--profile', '--parallel', '--progress', '--ansi'}
FLAG_OPTIONS = {'--compatibility', '--dry-run', '--all-resources'}


def compose_command(args: list[str]) -> str:
    index = 0
    while index < len(args):
        value = args[index]
        if value in READ_ONLY | RECOVERY | WRITE:
            return value
        if value in VALUE_OPTIONS:
            if index + 1 >= len(args):
                raise StorageError('Compose 全局选项缺少参数。')
            index += 2
        elif value in FLAG_OPTIONS or (value.startswith('--') and value.split('=')[0] in VALUE_OPTIONS and '=' in value):
            index += 1
        elif value in {'--help', '-h', '--version'}:
            return 'help'
        else:
            raise StorageError('无法识别 Compose 命令；请将全局选项写在子命令前，并使用完整选项。')
    raise StorageError('缺少 Compose 子命令。')


def main() -> int:
    args = sys.argv[1:]
    try:
        if args == ['--check']:
            preflight()
            return 0
        command = compose_command(args)
        invocation = ['docker', 'compose', *args]
        if command in READ_ONLY | RECOVERY:
            return subprocess.call(invocation)
        return guarded_run(invocation, preflight())
    except (StorageError, OSError) as exc:
        print(f'容量保护：{exc}', file=sys.stderr)
        return 75


if __name__ == '__main__':
    raise SystemExit(main())
