# Automatic initial allocation policy Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with independent review.

**Goal:** 승인 MOD03/04의 실제 하위 업무 배정에 초기 baseline 정책을 자동 연결해 수동 초기화 없이 관측 기반 관리 시작.
**Architecture:** resolveAllocationPolicy가 초기 정책을 순수하게 준비하고 replaceDelegation의 기존 부모 CAS/operationId-gated D1 batch에 부모·자식·정책을 함께 저장한다. 최초 baseline은 catalog.validate를 통과한 요청 모델/effort와 modelVersion:null, unvalidated_fallback으로만 기록한다.
**Spec:** docs/PRD.md MOD03/04/06/07. 추가 AI 실행이나 새 의존성 없음.

## Tasks
- [x] Tests first RED: 첫 Codex/Claude 배정 자동 정책 생성, 동일 요청 replay 무중복, 기존 정책/철회/고정 유지, stale catalog와 parent conflict/SQL 실패 시 정책 고아 없음.
- [x] worker/allocation-policy.mjs: 정책 없는 profile만 기존 createSelectionState로 준비, 기존 trusted availability/계정 validate/metadata guards 유지. baseline 실제 버전 null; assignment selection policyVersion1 + baseline_version_unverified. 사용자 입력의 policy/evidence/초기화 요청 필드는 신뢰하지 않음.
- [x] worker/delegations.mjs/worker/store.mjs: 초기 policy 계획을 내부 전달, parent CAS에 key 부재와 총 저장 한도 검증 포함, 성공 parent operationId에만 metadata INSERT. 실패/SQL 오류는 모든 변경 rollback, 경합 재시도는 최신 정책을 읽으며 덮어쓰기 금지. metadata prefix는 정확한 GLOB model_policy:* 사용.
- [x] 32개 상한: 가용 슬롯보다 신규 profile이 많으면 deterministic 일부만 초기화하거나 전체보류하되 기존 정책은 사용. 등록 못한 assignment는 검증된 기존 요청 경로 + 초기화 용량 보류 이유, policyVersion:null; 자동 삭제/기준변경/다른profile재사용 금지. full capacity에서도 일반 업무는 등록 보류 이유와 함께 진행 가능.
- [x] 기존 수동 initialize는 과거 미등록 작업에 유지. 자동 초기화된 작업의 management read는 실제 저장된 정책을 표시. 필요 사유 한국어 UI 한 줄 및 실제 흐름 테스트; 레이아웃 변경 없음.
- [x] 구현자 대상 GREEN→독립검토→메인 전체 Node/Worker dry-run/diff check→문서 및 개발 커밋. 운영 배포/실제 AI 호출 없음.

## Files and risks
worker/allocation-policy.mjs, worker/delegations.mjs, worker/store.mjs; 필요한 제한된 공유 상수/함수; tests/delegation-http.test.mjs 및 새 atomic initial-policy 시험, management 관련 회귀. docs는 메인 담당. 큰 저장 구조 재작성 금지. 정책 수명주기/일반화된 profile reuse와 실제 모델 버전 증거는 남은 범위이며 이 기능으로 품질 검증 또는 승격 완료를 주장하지 않는다.
