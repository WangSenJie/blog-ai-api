---
title: Pandas数据分析题解汇总
date: 2025-09-05 19:13:13
slug: pandas-data-analysis-notes
description: 汇总 LeetCode 175-197 的 Pandas 数据分析基础题解，涵盖连接、分组、排序、去重、排名与时间序列比较等常见操作。
categories:
  - Python 数据分析
  - Pandas
tags:
  - Python 数据分析
  - Pandas
  - LeetCode
toc: true
---

这篇笔记把 `Python 数据分析` 目录下的基础 Pandas 题解合并到了一起，方便集中查阅。内容主要覆盖连接、分组聚合、去重、排序排名以及简单的时间序列比较。

## LeetCode 175 组合两张表

表: Person

```text
+-------------+---------+
| 列名         | 类型     |
+-------------+---------+
| PersonId    | int     |
| FirstName   | varchar |
| LastName    | varchar |
+-------------+---------+
```

`personId` 是该表的主键（具有唯一值的列）。该表包含一些人的 ID 和他们的姓和名的信息。

表: Address

```text
+-------------+---------+
| 列名         | 类型    |
+-------------+---------+
| AddressId   | int     |
| PersonId    | int     |
| City        | varchar |
| State       | varchar |
+-------------+---------+
```

`addressId` 是该表的主键（具有唯一值的列）。该表的每一行都包含一个 `ID = PersonId` 的人的城市和州的信息。

编写解决方案，报告 `Person` 表中每个人的姓、名、城市和州。如果 `personId` 的地址不在 `Address` 表中，则报告为 `null`。以任意顺序返回结果表。

示例：

```text
Person 表:
+----------+----------+-----------+
| personId | lastName | firstName |
+----------+----------+-----------+
| 1        | Wang     | Allen     |
| 2        | Alice    | Bob       |
+----------+----------+-----------+

Address 表:
+-----------+----------+---------------+------------+
| addressId | personId | city          | state      |
+-----------+----------+---------------+------------+
| 1         | 2        | New York City | New York   |
| 2         | 3        | Leetcode      | California |
+-----------+----------+---------------+------------+
```

解答：

```python
import pandas as pd

def combine_two_tables(person: pd.DataFrame, address: pd.DataFrame) -> pd.DataFrame:
    return person.merge(address, on='personId', how='left')[['firstName', 'lastName', 'city', 'state']]
```

此题主要考察“左连接”。

## LeetCode 176 第二高的薪水

`Employee` 表：

```text
+-------------+------+
| Column Name | Type |
+-------------+------+
| id          | int  |
| salary      | int  |
+-------------+------+
```

`id` 是这个表的主键。表的每一行包含员工的工资信息。查询并返回 Employee 表中第二高的不同薪水。如果不存在第二高的薪水，查询应该返回 `null`，Pandas 则返回 `None`。

解答：

```python
import pandas as pd

def second_highest_salary(employee: pd.DataFrame) -> pd.DataFrame:
    salaries = employee['salary'].drop_duplicates().sort_values(ascending=False)
    out = [salaries.iloc[1] if len(salaries) > 1 else None]
    return pd.DataFrame({'SecondHighestSalary': out})
```

## LeetCode 177 第 n 高的薪水

表: Employee

```text
+-------------+------+
| Column Name | Type |
+-------------+------+
| id          | int  |
| salary      | int  |
+-------------+------+
```

`id` 是该表的主键（列中的值互不相同）。该表的每一行都包含有关员工工资的信息。编写一个解决方案查询 Employee 表中第 `n` 高的不同工资。如果少于 `n` 个不同工资，查询结果应该为 `null`。

解答：

```python
import pandas as pd

def nth_highest_salary(employee: pd.DataFrame, N: int) -> pd.DataFrame:
    salaries = employee['salary'].drop_duplicates().sort_values(ascending=False)
    out = [salaries.iloc[N - 1] if len(salaries) >= N and N > 0 else None]
    return pd.DataFrame({f'getNthHighestSalary({N})': out})
```

## LeetCode 178 分数排名

表: Scores

```text
+-------------+---------+
| Column Name | Type    |
+-------------+---------+
| id          | int     |
| score       | decimal |
+-------------+---------+
```

`id` 是该表的主键（有不同值的列）。该表的每一行都包含了一场比赛的分数。`score` 是一个有两位小数点的浮点值。编写一个解决方案来查询分数的排名。

排名规则：

- 分数按从高到低排列
- 如果两个分数相等，那么两个分数的排名应该相同
- 排名之间不应该有空缺的数字

解答：

```python
import pandas as pd

def order_scores(scores: pd.DataFrame) -> pd.DataFrame:
    scores['rank'] = scores['score'].rank(method='dense', ascending=False).astype(int)
    return scores[['score', 'rank']].sort_values(['score'], ascending=False)
```

## LeetCode 180 连续出现的数

表: `Logs`

```text
+-------------+---------+
| Column Name | Type    |
+-------------+---------+
| id          | int     |
| num         | varchar |
+-------------+---------+
```

在 SQL 中，`id` 是该表的主键。`id` 是一个自增列。找出所有至少连续出现三次的数字。

解答：

```python
import pandas as pd

def consecutive_numbers(logs: pd.DataFrame) -> pd.DataFrame:
    mask = (logs['num'] == logs['num'].shift(-1)) & (logs['num'] == logs['num'].shift(-2))
    return pd.DataFrame({'ConsecutiveNums': logs.loc[mask, 'num'].unique()})
```

## LeetCode 181 超过经理收入的员工

表: Employee

```text
+-------------+---------+
| Column Name | Type    |
+-------------+---------+
| id          | int     |
| name        | varchar |
| salary      | int     |
| managerId   | int     |
+-------------+---------+
```

`id` 是该表的主键。该表的每一行都表示雇员的 ID、姓名、工资和经理的 ID。编写解决方案，找出收入比经理高的员工。

解答：

```python
import pandas as pd

def find_employees(employee: pd.DataFrame) -> pd.DataFrame:
    df_merge = employee.merge(employee, left_on='managerId', right_on='id', suffixes=('', '_mgr'))
    out = df_merge.loc[df_merge['salary'] > df_merge['salary_mgr'], ['name']]
    return out.rename(columns={'name': 'Employee'})
```

## LeetCode 182 查找重复的电子邮箱

表: Person

```text
+-------------+---------+
| Column Name | Type    |
+-------------+---------+
| id          | int     |
| email       | varchar |
+-------------+---------+
```

`id` 是该表的主键。此表的每一行都包含一封电子邮件。电子邮件不包含大写字母。编写解决方案来报告所有重复的电子邮件。

解法一：

```python
import pandas as pd

def duplicate_emails(person: pd.DataFrame) -> pd.DataFrame:
    df = person.groupby('email').size().reset_index().rename(columns={'email': 'x', 0: 'y'})
    df_m = person.merge(df, left_on='email', right_on='x', how='left')
    return df_m.loc[df_m['y'] >= 2, ['email']].rename(columns={'email': 'Email'}).reset_index(drop=True).drop_duplicates()
```

解法二：

```python
import pandas as pd

def duplicate_emails(person: pd.DataFrame) -> pd.DataFrame:
    return person['email'].value_counts().loc[lambda x: x > 1].index.to_frame(name='Email').reset_index(drop=True)
```

## LeetCode 183 从不订购的客户

Customers 表：

```text
+-------------+---------+
| Column Name | Type    |
+-------------+---------+
| id          | int     |
| name        | varchar |
+-------------+---------+
```

Orders 表：

```text
+-------------+------+
| Column Name | Type |
+-------------+------+
| id          | int  |
| customerId  | int  |
+-------------+------+
```

找出所有从不点任何东西的顾客。

解答：

```python
import pandas as pd

def find_customers(customers: pd.DataFrame, orders: pd.DataFrame) -> pd.DataFrame:
    df_merge = customers.merge(orders[['customerId']], left_on='id', right_on='customerId', how='left')
    return df_merge.loc[df_merge['customerId'].isna(), ['name']].rename(columns={'name': 'Customers'}).reset_index(drop=True)
```

## LeetCode 184 部门工资最高的员工

表：`Employee`

```text
+--------------+---------+
| 列名          | 类型    |
+--------------+---------+
| id           | int     |
| name         | varchar |
| salary       | int     |
| departmentId | int     |
+--------------+---------+
```

表：`Department`

```text
+-------------+---------+
| 列名         | 类型    |
+-------------+---------+
| id          | int     |
| name        | varchar |
+-------------+---------+
```

查找出每个部门中薪资最高的员工。

解答：

```python
import pandas as pd

def department_highest_salary(employee: pd.DataFrame, department: pd.DataFrame) -> pd.DataFrame:
    max_salary = employee.groupby('departmentId')['salary'].transform('max')
    employee1 = employee.loc[employee['salary'] == max_salary]
    return employee1.merge(
        department,
        left_on='departmentId',
        right_on='id',
        suffixes=('', '_d')
    )[['name_d', 'name', 'salary']].rename(
        columns={'name_d': 'Department', 'name': 'Employee', 'salary': 'Salary'}
    ).reset_index(drop=True)
```

## LeetCode 185 部门工资前三高的所有员工

表: `Employee`

```text
+--------------+---------+
| Column Name  | Type    |
+--------------+---------+
| id           | int     |
| name         | varchar |
| salary       | int     |
| departmentId | int     |
+--------------+---------+
```

表: `Department`

```text
+-------------+---------+
| Column Name | Type    |
+-------------+---------+
| id          | int     |
| name        | varchar |
+-------------+---------+
```

找出每个部门中收入高的员工。一个部门的高收入者，是指工资在该部门不同工资中排名前三的员工。

解答：

```python
import pandas as pd

def top_three_salaries(employee: pd.DataFrame, department: pd.DataFrame) -> pd.DataFrame:
    rank_in_dep = employee.groupby('departmentId')['salary'].rank(method='dense', ascending=False)
    df = employee.loc[rank_in_dep <= 3]
    return df.merge(
        department,
        left_on='departmentId',
        right_on='id',
        how='left',
        suffixes=('', '_dep')
    )[['name_dep', 'name', 'salary']].rename(
        columns={'name_dep': 'Department', 'name': 'Employee', 'salary': 'Salary'}
    ).reset_index(drop=True)
```

## LeetCode 196 删除重复的电子邮箱

表: Person

```text
+-------------+---------+
| Column Name | Type    |
+-------------+---------+
| id          | int     |
| email       | varchar |
+-------------+---------+
```

编写解决方案删除所有重复的电子邮件，只保留一个具有最小 `id` 的唯一电子邮件。

解答：

```python
import pandas as pd

def delete_duplicate_emails(person: pd.DataFrame) -> None:
    person.drop(person.loc[person['id'] != person.groupby('email')['id'].transform('min')].index, inplace=True)
```

## LeetCode 197 上升的温度

表：Weather

```text
+---------------+---------+
| Column Name   | Type    |
+---------------+---------+
| id            | int     |
| recordDate    | date    |
| temperature   | int     |
+---------------+---------+
```

找出与之前一天相比温度更高的所有日期的 `id`。

解答：

```python
import pandas as pd
import datetime

def rising_temperature(weather: pd.DataFrame) -> pd.DataFrame:
    weather.sort_values('recordDate', inplace=True)
    weather_diff = weather.diff()
    return weather.loc[
        (weather_diff['recordDate'] == datetime.timedelta(1)) & (weather_diff['temperature'] > 0),
        ['id']
    ]
```
