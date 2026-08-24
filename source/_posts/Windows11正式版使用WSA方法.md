---
title: "Windows11正式版使用WSA方法"
date: "2023-03-06 19:09:13"
updated: "2023-03-23 20:29:16"
slug: "Windows11正式版使用WSA方法"
tags: ["教程"]
categories: []
cover: "https://th.bing.com/th/id/OIP.a2Lqu-6xruSIqultkPCUYwHaEs?pid=ImgDet&rs=1"
description: "tip: 本文仅在greataden.top发表， 转载请注明出处。 今天我要来介绍的是WSA（Windows Subsystem of Android)在Win11非预览正式版的电脑上安装和使用的说明。提前声明一下，这篇教程结合网络和个人经验写成，具体情况具体对待。 准备工作1. WSA环境依次打开“设置”-“可选功"
---
tip: 本文仅在greataden.top发表， 转载请注明出处。

* * *

今天我要来介绍的是WSA（Windows Subsystem of Android)在Win11非预览正式版的电脑上安装和使用的说明。提前声明一下，这篇教程结合网络和个人经验写成，具体情况具体对待。

# 准备工作

## 1\. WSA环境

依次打开“设置”-“可选功能”-“更多Windows功能”，找到<strong>Hyper-V</strong>，<strong>Windows虚拟机监控程序平台</strong>，<strong>虚拟机平台</strong>这三个选项打钩，然后点确定，等待功能添加完成后<strong>重启电脑</strong>。

<strong>假如你使用的是Windows11家庭版，没有Hyper-V，请参考[这篇文章](https://zhuanlan.zhihu.com/p/512823841)</strong>

## 2\. WSA程序包

下载WSA环境安装包，此版本是1.8.32822.0，感谢远景的网友提供下载链接。[天翼云链接](https://cloud.189.cn/t/mymIZjJnyY7n)：访问码:srm6

当然，你也可以在[微软商店](https://apps.microsoft.com/store/detail/windows-subsystem-for-android%E2%84%A2-with-amazon-appstore/9P3395VX91NR?hl=en-us&gl=us)直接下载，这里需要将系统<strong>时间和语言</strong>设置的<strong>国家或地区</strong>改为<strong>美国</strong>。遇到下载问题可以参考下面部分第二点<strong>安装WSA Toolbox</strong>的加粗注释

# 开整

## 1.安装WSA环境

刚才准备工作里面下载好的程序包找一个<strong>没有中文名称</strong>的文件夹放好，同时按住Win+X组合键，选择

“Windows PowerShell(管理员)”，然后定位到WSA文件存储的位置。

比如，放在D盘downloads文件夹，那就![](https://pic1.zhimg.com/80/v2-d831d31e0ae17af0f6f94fa8b978215c_720w.webp)

通过这个命令然后按下Enter来安装

```powershell
Add-AppxPackage -Path MicrosoftCorporationII.WindowsSubsystemForAndroid_1.8.32822.0_neutral___8wekyb3d8bbwe.Msixbundle
```

其实你没必要输入这么多，只需要在Add-APPxPackage -Path后按下Tab键选择你下载的文件就行了。

<strong>注意，这个时候如果提示安装错误，其中有Microsoft.UI.Xaml.2.6的字样，你就[到这里下载](https://apps.microsoft.com/store/detail/microsoftuixaml26/9MXT2SGCT564)一个补充包就好了</strong>

## 2.安装WSA Toolbox

在原文中是让你下载adb tools通过adb的方式安装apk，但是我个人觉得太麻烦了，不如直接下载一个[WSA Toolbox](https://apps.microsoft.com/store/detail/wsa%E5%B7%A5%E5%85%B7%E7%AE%B1/9PPSP2MKVTGT?hl=zh-cn&gl=cn)来的方便。

<strong>如果遇到下载方面的问题，可以参考[这个视频](https://www.bilibili.com/video/BV1ca41117Wk/?vd_source=51c0287a5d3458a92b7796d97d73cb37)，我有这个软件原作者的链接，从[这里下载](https://wwd.lanzouj.com/iaGQO05wvi2j)</strong>

## 3.打开WSA系统设置

![](https://pic3.zhimg.com/v2-7fd8f5e3f8edeaa8af59c03b35a60dce_r.jpg)

然后在设置中开启“开发者模式”

## 4.WSA工具箱的使用

打开WSA工具箱，首次使用可能需要在<strong>故障诊断</strong>中配置adb相关设置，首次配置结束后，可以进行安装APK，APP管理等相关内容。

##### 同时，为了节省资源，不用WSA的时候可以在子系统设置里面把子系统关闭，要用的时候再打开

# 后话

我最早接触WSA还是上一台电脑的Win11预览版，也就是Win11才发布WSA这个项目没多久的时候。当时安卓内核还是安卓12，现在已经升级到了安卓13，并且在流畅度和稳定性上面都有不小的提升。我看好巨硬的这个项目有朝一日能干碎国内那些广告多还不好用的模拟器

本文参考[知乎文章](https://zhuanlan.zhihu.com/p/431557897)写成，其中包含了一些现在安装可能遇到的一些问题，如有侵权请联系删除
