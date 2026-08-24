---
title: "MIUI EU添加国内版钱包实现刷公交卡和门卡"
date: "2024-01-05 19:07:05"
updated: "2024-01-05 19:25:15"
slug: "MIUI-EU添加国内版钱包实现刷公交卡和门卡"
tags: ["教程"]
categories: []
cover: "https://w.wallhaven.cc/full/rr/wallhaven-rr1wkw.jpg"
description: "众所周知，MIUI是臃肿和卡顿的代名词。而这个现象只存在于国内版，虽然MIUI14剃刀计划使系统流畅性大幅提升，但是还不够。相比于MIUI EU（MIUI欧洲版）来说，欧洲版更加简洁、轻快、满血的FCM，而重点是无广告，无广告，无广告！ 废话不多说，直接一个模块解决问题！今天介绍的是MIUI国际版添加小米钱包组件的模块"
---
众所周知，MIUI是臃肿和卡顿的代名词。而这个现象只存在于国内版，虽然MIUI14剃刀计划使系统流畅性大幅提升，但是还不够。相比于MIUI EU（MIUI欧洲版）来说，欧洲版更加简洁、轻快、满血的FCM，而重点是<strong>无广告，无广告，无广告！</strong>

* * *

废话不多说，直接一个模块解决问题！今天介绍的是MIUI国际版添加小米钱包组件的模块，原作者是[华梦博客](https://52huameng.com/software/1614)，但是这个教程是2020年的，部分组件已经outdated了，我经过改良发布这个新模块。这个模块完全适配CAS（小米10至尊），其他MIUI14/HyperOS机型理论上也通用。不通用也不要紧，下面我来说如何修改模块来适配你自己的手机

1.  提取钱包APP、小米智能卡、小米智能卡组件以及银联安全组件。
    
    ```
    /system/app/NextPay #小米智能卡相关组件
    /system/app/TSMClient #小米智能卡
    /system/app/UPTsmService #银联安全组件
    ```
    
    最简单的方法就是找你同机型国内版的兄弟麻烦一下他们。那么假如我们没有兄弟（bushi）怎么办呢，可以使用dump的方式。dump是网站上别人解好的包方便做定制版。这里我提供[CAS](https://dumps.tadiphone.dev/dumps/xiaomi/cas)的dump，其他机型可以自己在这个网站上寻找。
    
    而在dump中，钱包APP、小米智能卡、小米智能卡组件以及银联安全组件的位置是
    
    ```
    /cas/product/app/MINextpay
    /cas/product/app/UPTsmService
    /cas/product/app/MITSMClient
    ```
    
2.  把这三个文件替换模块文件中的system/app文件夹中的文件，使用Magisk刷入即可
    

[https://xmxk.lanzouu.com/iv0KE1k5kg2f](https://xmxk.lanzouu.com/iv0KE1k5kg2f)
