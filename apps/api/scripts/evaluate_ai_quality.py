"""成对合成评测集：校验清单、重放报告，或显式启用真实模型调用。"""
import argparse
import hashlib
import json
import math
import os
from types import SimpleNamespace
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.ai_quality import DEFAULT_REVIEW_TEMPLATE, extract_result, validate_review_result, route_by_strategy, route_with_confidence
from app.services.ai_workflow import VERSION, review_messages

ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "evals" / "annotation-quality-v1.jsonl"
DIMENSIONS = [{"key":"correctness","label":"标注正确性","description":"答案与规范相符得100分，错误得0分，无法判断需转人工。","weight":1.0,"scoreRange":[0,100]}]
THRESHOLDS = {"passScore":0.8,"returnScore":0.45}


def load_cases(path=CORPUS):
    cases=[json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    ids=[c["id"] for c in cases]
    if len(set(ids))!=len(ids): raise ValueError("评测 ID 重复")
    groups={}
    for c in cases:
        if c["expectedReview"] not in ("PASS","RETURN","NEED_HUMAN_REVIEW"): raise ValueError("评测标签非法")
        groups.setdefault(c["group"],set()).add(c["split"])
    if any(len(s)>1 for s in groups.values()): raise ValueError("同组原始题目跨数据集泄漏")
    return cases


def rate(numerator, denominator):
    if not denominator: return {"count":numerator,"denominator":0,"rate":None,"wilson95":None}
    p=numerator/denominator; z=1.96; n=denominator
    centre=(p+z*z/(2*n))/(1+z*z/n)
    half=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/(1+z*z/n)
    return {"count":numerator,"denominator":n,"rate":p,"wilson95":[max(0,centre-half),min(1,centre+half)]}


def summarize(rows, cases):
    attempts = rows
    rows = [r for r in attempts if r.get("error") != "TRANSPORT_ERROR"]
    by_id={c["id"]:c for c in cases}
    expected=[by_id[r["caseId"]]["expectedReview"] for r in rows]
    actual=[r["decision"] for r in rows]
    good=sum(e=="PASS" for e in expected); bad=sum(e=="RETURN" for e in expected)
    passed=sum(a=="PASS" for a in actual)
    durations=sorted(r["latencyMs"] for r in rows)
    return {"trials":len(attempts),"qualityEligibleTrials":len(rows),"uniqueCases":len(set(r["caseId"] for r in attempts)),
        "modelDecisionAgreement":rate(sum(r.get("modelDecision")==e for r,e in zip(rows,expected)),len(rows)),
        "decisionAgreement":rate(sum(a==e for a,e in zip(actual,expected)),len(rows)),
        "wrongAnnotationAutoPass":rate(sum(e=="RETURN" and a=="PASS" for e,a in zip(expected,actual)),bad),
        "correctAnnotationAutoReturn":rate(sum(e=="PASS" and a=="RETURN" for e,a in zip(expected,actual)),good),
        "autoPassError":rate(sum(e!="PASS" and a=="PASS" for e,a in zip(expected,actual)),passed),
        "humanReview":rate(sum(a=="NEED_HUMAN_REVIEW" for a in actual),len(rows)),
        "invalidOutput":rate(sum(r.get("error")=="INVALID_OUTPUT" for r in rows),len(rows)),
        "transportFailures":sum(r.get("error")=="TRANSPORT_ERROR" for r in attempts),
        "latencyP50Ms":statistics.median(durations) if durations else None,
        "latencyP95Ms":durations[max(0,math.ceil(len(durations)*.95)-1)] if durations else None,
        "totalTokens":sum(r.get("totalTokens") or 0 for r in rows),
        "interpretation":"合成探索样本；重复试验不独立，区间仅描述本次试验，不能外推真实任务误判率。"}


def snapshot(case, model):
    return {"version":VERSION,"promptTemplate":DEFAULT_REVIEW_TEMPLATE,"model":{"model":model},
        "context":{"task":{"id":"eval","title":"证据一致性","description":"只根据给定记录判断。记录缺失或矛盾则无法判断。","instructionRichText":None},
        "item":{"sourcePayload":case["sourcePayload"]},"submission":{"answers":case["answers"],"attemptNo":1},
        "schema":{"root":{"kind":"CONTAINER","children":[{"kind":"FIELD","name":"verdict"},{"kind":"FIELD","name":"reason"}]}},
        "dimensions":DIMENSIONS,"thresholds":THRESHOLDS}}


def live_run(cases, variant, trials):
    from app.services.ai_quality import AI_REVIEW_TOOL
    required = ["DOUBAO_API_KEY", "DOUBAO_BASE_URL", "DOUBAO_MODEL"]
    if any(not os.environ.get(k) for k in required): raise SystemExit("缺少模型配置，请通过 --env-file 提供；不会打印配置值")
    settings = SimpleNamespace(**{k:os.environ[k] for k in required})
    from jinja2 import Template
    from openai import OpenAI
    baseline=json.loads((ROOT/"evals"/"baseline-v1.json").read_text())
    client=OpenAI(api_key=settings.DOUBAO_API_KEY,base_url=settings.DOUBAO_BASE_URL,timeout=30,max_retries=0)
    rows=[]
    for case in cases:
        for trial in range(trials):
            fixed=snapshot(case,settings.DOUBAO_MODEL)
            if variant=="current": messages=review_messages(fixed)
            else:
                key="_PREF_REVIEW_PROMPT" if case["taskType"]=="preference" else "_QA_REVIEW_PROMPT"
                messages=[{"role":"user","content":Template(baseline["prompts"][key]).render(**fixed["context"])}]
            row={"caseId":case["id"],"trial":trial,"model":settings.DOUBAO_MODEL,"variant":variant,"decision":"NEED_HUMAN_REVIEW"}
            start=time.monotonic()
            try:
                reply=client.chat.completions.create(model=settings.DOUBAO_MODEL,messages=messages,tools=[AI_REVIEW_TOOL],
                    tool_choice={"type":"function","function":{"name":"submit_ai_review_result"}},temperature=0,max_tokens=4096)
            except Exception as exc:
                row["error"]="TRANSPORT_ERROR"
                row["errorType"]=type(exc).__name__
                row["httpStatus"]=getattr(exc,"status_code",None)
            else:
                row["totalTokens"]=getattr(getattr(reply,"usage",None),"total_tokens",None)
                try:
                    raw=extract_result(reply,"submit_ai_review_result")
                    row["output"]=raw
                    row["modelDecision"]=raw.get("decision")
                    if variant=="current":
                        checked=validate_review_result(raw,DIMENSIONS,THRESHOLDS,{"verdict","reason"})
                        decision,_=route_by_strategy(checked["decision"],"AUTO_PASS_RETURN",checked["totalScore"],THRESHOLDS)
                        row["decision"]=route_with_confidence(decision,checked["confidence"],0.6)[0]
                    else:
                        # 基线比较模板判断，保留原始 decision；不伪称模拟所有历史部署策略。
                        if raw.get("decision") not in ("PASS","RETURN","NEED_HUMAN_REVIEW"): raise ValueError()
                        row["decision"]=raw["decision"]
                except (ValueError,TypeError,KeyError): row["error"]="INVALID_OUTPUT"
            row["latencyMs"]=round((time.monotonic()-start)*1000)
            rows.append(row)
            print(f"{case['id']} trial={trial+1} completed",file=sys.stderr)
    return rows


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus",type=Path,default=CORPUS)
    parser.add_argument("--live",action="store_true")
    parser.add_argument("--variant",choices=["baseline","current"],default="current")
    parser.add_argument("--trials",type=int,default=1)
    parser.add_argument("--limit",type=int)
    parser.add_argument("--env-file",type=Path)
    parser.add_argument("--replay",type=Path)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    if args.trials<1 or args.trials>5: parser.error("trials 必须为 1..5")
    if args.live and args.replay: parser.error("live 与 replay 不能同时使用")
    if args.env_file:
        from dotenv import load_dotenv
        load_dotenv(args.env_file,override=False)
    cases=load_cases(args.corpus)
    if args.limit is not None:
        if args.limit<1: parser.error("limit 必须为正数")
        cases=cases[:args.limit]
    rows=live_run(cases,args.variant,args.trials) if args.live else json.loads(args.replay.read_text())["results"] if args.replay else []
    report={"suite":"annotation-quality-v1","corpusSha256":hashlib.sha256(args.corpus.read_bytes()).hexdigest(),
        "baselineCommit":"bcf5117e6d045c7de4dc2f1bcd3461e1be9f42d6","variant":args.variant,
        "mode":"live" if args.live else "replay" if args.replay else "manifest-only","cases":len(cases),
        "origin":"synthetic; not human-adjudicated production data","results":rows,
        "metrics":summarize(rows,cases) if rows else None}
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({k:v for k,v in report.items() if k!="results"},ensure_ascii=False))
    if rows and all(r.get("error")=="TRANSPORT_ERROR" for r in rows): raise SystemExit(2)


if __name__=="__main__": main()
