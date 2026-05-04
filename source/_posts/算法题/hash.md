---
title: LeetCode Hot100 —— Hash
slug: hash
date: 2026-04-17
description: LeetCode-hot100 中“哈希”部分的题解
# cover: /images/leetcode.png
categories:
  - 算法题
tags:
  -  Hash
comments: True
mathjax: true
---

# Hash

## (1) 两数之和
给定一个整数数组 `nums` 和一个整数目标值 `target`, 请你在该数组中找出和为目标值 `target` 的那两个整数, 并返回它们的数组下标.
- 你可以假设每种输入只会对应一个答案，并且你不能使用两次相同的元素。
- 你可以按任意顺序返回答案。

```
示例 1：

输入：nums = [2,7,11,15], target = 9
输出：[0,1]
解释：因为 nums[0] + nums[1] == 9 , 返回 [0, 1].
```

> 使用 `hash` 表 `hashtable = {num: index}`
> - 遍历 `nums` 数组, 每次取得一个 `num`, 如果 `target-num` 在 `hashtable` 中, 则直接返回下标对.
> - 每一次遍历最后都要在 `hashtable` 中建立键值对.

```python
class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        hashtable = dict()
        for i, num in enumerate(nums):
            if target-num in hashtable:
                return [hashtable[target-num], i]
            hashtable[num] = i
        return
```

## (49) 字母异构
给你一个字符串数组, 请你将字母异位词组合在一起. 可以按任意顺序返回结果列表.
```
示例:

输入: strs = ["eat", "tea", "tan", "ate", "nat", "bat"]

输出: [["bat"],["nat","tan"],["ate","eat","tea"]]

解释：
    在 strs 中没有字符串可以通过重新排列来形成 "bat"。
    字符串 "nat" 和 "tan" 是字母异位词，因为它们可以重新排列以形成彼此。
    字符串 "ate" ，"eat" 和 "tea" 是字母异位词，因为它们可以重新排列以形成彼此。
```

> 使用 Hash 表, `hashtable = {s_sort: [s]}`
> - 遍历 `strs` 中所有字符串, 得到 `s`, 在 `hashtable` 中存储键值对, 其中键为排序后的 `s_sort`, 值为列表, 存储所有与 `s_sort` 字符成分组成一致的字符串, 例 `{'aet': 'eat', 'tea', 'ate'}`

```python
class Solution
    def groupAnagrams(self, strs: List[str]) -> List[List[str]]:
        hashtable = defaultdict(list) # 默认值为列表类型
        for s in strs:
            s_sort = ''.join(sorted(s))
            hashtable[s_sort].append(s)
        return list(hashtable.values())
```

## (128) 最长连续序列
给定一个未排序的整数数组 `nums`, 找出数字连续的最长序列 (不要求序列元素在原数组中连续) 的长度.

请你设计并实现时间复杂度为 `O(n)` 的算法解决此问题.
```
示例 1：

输入：nums = [100,4,200,1,3,2]
输出：4
解释：最长数字连续序列是 [1, 2, 3, 4]。它的长度为 4。
```
> 使用 Hash 表, `hashtable = {num: length}`, 记录当前数字 `num` 所在的最长连续序列的长度. 而 `num` 的最长连续序列长度一定是 `num-1` 的最长连续序列长度 + `num+1` 的最长连续序列长度 + 1
> - 遍历 `nums` 中的所有 `num`. 若 `num` 已经在 `hashtable` 中, 则跳过此轮循环; 如果 `num` 不在 `hashtable` 中, 则要将他加入到 `hashtable` 中:
>   - 搜索 `hashtable` 中是否有 `num-1` 和 `num+1`. 
>       - 如果存在 `num-1`, 则令 `length_left = hashtable[num-1]`, 否则, 令 `length_left = 0`;
>       - 如果存在 `num+1`, 则令 `length_right = hashtable[num+1]`, 否则, 令 `length_right = 0`.
>   - 创建键值对 `hashtable[num] = length_left + length_right + 1`
>   - 更新此时最长连续序列的边界点的 `length`, 因此以后改连续序列内部的 `num` 不会影响结果了.

```python
class Solution:
    def longestConsecutive(self, nums: List[int]) -> int:
        if not nums:
            return 0
            
        hashtable = {}
        for num in nums:
            if num in hashtable:
                continue
            length_left = hashtable.get(num-1, 0)
            length_right = hashtable.get(num+1, 0)
            length = length_left + length_right + 1
            hashtable[num] = length
            # 更新序列边界点
            hashtable[num-length_left] = length
            hashtable[num+length_right] = length
        return max(hashtable.values())

```
