# CawPlan Skill Cookbook

Task-oriented examples for CawPlan agent skills.

## 1. cawplan-query

Products, versions, releases, general read queries

```text
/cawplan-query find product information for "UniFi Access"
/cawplan-query search knowledge for UniFi Access: door schedule setup
```

## 2. cawplan-ticket

Ticket create, update, search, poll, relations

```text
/cawplan-ticket create a backlog ticket for UniFi Access: investigate door schedule issue
/cawplan-ticket file a HIGH bug on UniFi Access 4.1.10: door stuck after firmware update, assign to yida.chen@ui.com
```

## 3. cawplan-my-todos

Assigned tickets and critical issues

```text
/cawplan-my-todos show my open tickets and critical issues
```

## 4. cawplan-user-activity

User activity report over a date range

```text
/cawplan-user-activity summarize what user@ui.com did in the past two weeks
```

## 5. cawplan-product-activity

Product activity report over a date range

```text
/cawplan-product-activity show UniFi Access activity for last week
/cawplan-product-activity show UniFi Access 4.1.10 activity from 2026-06-01 to 2026-06-10
```

## 6. cawplan-critical

Critical issue search and detail

```text
/cawplan-critical search critical issues for UniFi Access in the last month
```

## 7. cawplan-metrics

Product metrics over a time range

```text
/cawplan-metrics show UniFi Access metrics for the last month
```

## 8. cawplan-analytics

AI feedback analytics

```text
/cawplan-analytics show AI feedback analytics for UniFi Access
```

## 9. cawplan-qa-report

QA test reports

```text
/cawplan-qa-report show QA report for UniFi Access 4.1.10
```
