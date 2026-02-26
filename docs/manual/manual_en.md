# User Manual - Turbo EA

## Enterprise Architecture Management Platform

**Guide for Executives and Decision Makers** | February 2026

---

## Table of Contents

1. [Introduction to Turbo EA](#1-introduction-to-turbo-ea)
2. [Accessing the Platform](#2-accessing-the-platform)
3. [Dashboard](#3-dashboard)
4. [Inventory](#4-inventory)
5. [Card Details](#5-card-details)
6. [Reports](#6-reports)
7. [Business Process Management (BPM)](#7-business-process-management-bpm)
8. [Diagrams](#8-diagrams)
9. [EA Delivery](#9-ea-delivery)
10. [Tasks and Surveys](#10-tasks-and-surveys)
11. [Administration](#11-administration)
12. [Glossary of Terms](#12-glossary-of-terms)

---

## 1. Introduction to Turbo EA

### What is Turbo EA?

**Turbo EA** is a modern, self-hosted platform for **Enterprise Architecture Management**. It enables organizations to document, visualize, and manage all components of their business and technology architecture in one place.

### Who is this guide for?

This guide is designed for **executives and decision makers** who need to evaluate and understand the capabilities of Turbo EA before adopting the platform in their organization. No advanced technical knowledge is required to use the tool.

### Key Benefits

- **Comprehensive visibility**: View all applications, processes, capabilities, and technologies across the organization in a single platform.
- **Informed decision-making**: Visual reports that facilitate evaluation of the current state of technology infrastructure.
- **Lifecycle management**: Track the status of every technology component, from implementation through retirement.
- **Collaboration**: Multiple users can work simultaneously, with configurable roles and permissions.
- **Multi-language**: Available in English, Spanish, French, German, Italian, Portuguese, and Chinese.

### Key Concepts

| Term | Meaning |
|------|---------|
| **Card** | The basic element of the platform. Represents any architecture component: an application, a process, a business capability, etc. |
| **Card Type** | The category a card belongs to (Application, Business Process, Organization, etc.) |
| **Relationship** | A connection between two cards that describes how they relate (e.g., "uses", "depends on", "is part of") |
| **Metamodel** | The structure that defines what card types exist, what fields they have, and how they relate to each other |
| **Lifecycle** | The temporal state of a component (Active, In Development, Retired, etc.) |
| **BPM** | Business Process Management |

---

## 2. Accessing the Platform

### Logging In

When accessing the platform, the login screen is displayed where you must enter your email address and password.

**Steps to log in:**

1. Open your web browser and enter the platform URL
2. In the **Email** field, type your registered email address
3. In the **Password** field, type your password
4. Click the **Log In** button

**Important note:** The first user to register on the platform automatically receives the **Administrator** role, which allows them to configure the entire system.

### Registering New Users

If this is your first time accessing the platform, you can register by clicking "Sign Up". Administrators can also invite users from the administration panel.

### Changing Language

The platform supports multiple languages. To change the language:

1. Click on your profile icon (top right corner)
2. Select **Language**
3. Choose the desired language (English, Espanol, Francais, Deutsch, Italiano, Portugues, Chinese)

---

## 3. Dashboard

The Dashboard is the first screen you see after logging in. It provides a **quick overview** of the entire enterprise architecture status.

![Dashboard - Top View](img/en/01_dashboard.png)

### Dashboard Elements

#### Top Navigation Bar

At the top of the screen, you will find the **main navigation bar** with the following elements:

- **Turbo EA** (logo): Click to return to the Dashboard from any section
- **Dashboard**: Overview of the architecture status
- **Inventory**: Complete listing of all cards (components)
- **Reports**: Visual and analytical reports
- **BPM**: Business Process Management
- **Diagrams**: Visual architecture diagram editor
- **Delivery**: Architecture project and initiative management
- **Todos**: Pending tasks and assigned surveys
- **Search cards**: Quick search bar
- **+ Create**: Button to quickly create new cards
- **Notification bell**: System alerts and notifications
- **Profile icon**: Personal settings and administration

#### Summary Cards

The main section of the Dashboard displays **summary cards** indicating:

- **Total number of cards**: Total count of components registered in the platform (e.g., 324 items)
- **Distribution by type**: How many elements of each type exist (Applications, Organizations, Objectives, Capabilities, etc.)
- **Status charts**: Quick visualizations of the overall status

![Dashboard - Bottom View with Charts](img/en/02_dashboard_bottom.png)

#### Charts and Statistics

In the bottom section of the Dashboard you will find:

- **Distribution by type chart**: Shows the proportion of each card type
- **Approval status**: Indicates how many cards are approved, pending, or rejected
- **Data quality**: Overall percentage of information completeness

---

## 4. Inventory

The **Inventory** is the heart of Turbo EA. Here all **cards** (components) of the enterprise architecture are listed: applications, processes, business capabilities, organizations, providers, interfaces, and more.

![Inventory View with Filter Panel](img/en/23_inventory_filters.png)

### Inventory Screen Structure

#### Left Filter Panel

The left sidebar panel allows you to **filter** cards by different criteria:

- **Search**: Free text search field
- **Types**: Filter by card type: Objective, Platform, Initiative, Organization, Business Capability, Business Context, Business Process, Application, Interface, Data Object, IT Component, Tech Category, Provider
- **Approval Status**: Filter by approved, pending, or rejected cards
- **Lifecycle**: Filter by lifecycle state (Active, In Development, Retired, etc.)
- **Data Quality**: Filter by data completeness level
- **Show archived only**: Option to view archived cards
- **Save view**: Save filter configurations for reuse

#### Main Table (Center)

| Column | Description |
|--------|-------------|
| **Type** | Card category (color-coded) |
| **Name** | Component name |
| **Description** | Brief description of the component |
| **Lifecycle** | Current state (active, retired, etc.) |
| **Approval Status** | Whether it has been approved by responsible parties |
| **Data Quality** | Completeness percentage (progress bar) |

#### Toolbar (Top Right)

- **Grid Edit**: Edit multiple cards simultaneously in table mode
- **Export**: Download data to Excel format
- **Import**: Bulk upload data from Excel files
- **+ Create**: Create a new card

![Create Card Dialog](img/en/22_create_card.png)

### How to Create a New Card

1. Click the **+ Create** button (blue, top right corner)
2. In the dialog that appears:
   - Select the **Type** of card (Application, Process, Objective, etc.)
   - Enter the **Name** of the component
   - Optionally, add a **Description**
3. Click **CREATE**

---

## 5. Card Details

Clicking on any card in the inventory opens the **detail view** where you can view and edit all information about the component.

![Card Detail View](img/en/04_card_detail.png)

### Available Tabs in Card Detail

#### "Detail" Tab (Main)

- **Name and type** of the card (top left corner)
- **Approval status**: Green "Approved" badge or pending status
- **Description**: Descriptive text about the component
- **Custom attributes**: Specific fields depending on the card type
- **Relationships**: List of connections to other cards
- **Lifecycle**: Temporal state of the component
- **Tags**: Additional classifications assigned

#### "Comments" Tab

![Card Comments Section](img/en/05_card_comments.png)

- **Add comments**: Any user can leave notes or questions about the component
- **Team discussion**: Comments create a conversation thread
- **Decision history**: Document the reasoning behind important changes

#### "Todos" Tab

![Todos Associated with a Card](img/en/06_card_todos.png)

- **Create new todo**: Assign tasks to team members
- **Task status**: Pending, In Progress, Completed
- **Assignee**: Person assigned to complete the task
- **Due date**: Deadline for completing the task

#### "Stakeholders" Tab

![Card Stakeholders](img/en/07_card_stakeholders.png)

- **Business Owner**: Responsible for business decisions
- **Technical Owner**: Responsible for technical decisions
- **Other roles**: According to metamodel configuration

#### "History" Tab

![Card Change History](img/en/08_card_history.png)

Shows the **complete record of changes** made to the card: **Who** made the change, **When** it was made, **What** was modified (previous value vs. new value). This enables a **complete audit** of all modifications.

---

## 6. Reports

Turbo EA includes a powerful **visual reporting** module that allows analyzing the enterprise architecture from different perspectives. Reports are designed to facilitate **decision-making** by executives.

![Available Reports Menu](img/en/09_reports_menu.png)

### 6.1 Portfolio Report

![Portfolio Report](img/en/10_report_portfolio.png)

The **Portfolio Report** provides an **overview of all architecture components** grouped by type. It is ideal for evaluating the size of the technology portfolio, identifying areas of concentration, comparing categories, and filtering by different criteria.

### 6.2 Capability Map

![Business Capability Map](img/en/11_capability_map.png)

The **Capability Map** shows a hierarchical view of the organization's **business capabilities**. Each block represents a business capability, colors may indicate the maturity level or status, and the hierarchy shows main capabilities and their sub-capabilities.

### 6.3 Lifecycle

![Lifecycle Report](img/en/12_lifecycle.png)

The **Lifecycle Report** shows the temporal state of technology components. It is critical for retirement planning, obsolescence management, and budget planning. States: **Active**, **In Development**, **Phasing Out**, **Retired**.

### 6.4 Dependencies

![Dependencies Report](img/en/13_dependencies.png)

The **Dependencies Report** visualizes **connections between components**. Fundamental for impact analysis, identifying critical points, planning migrations, and reducing risks.

### 6.5 Other Available Reports

- **Cost Report**: Analysis of licensing, maintenance, and operation costs
- **Matrix Report**: Cross-view comparing two dimensions of the architecture
- **Data Quality**: Shows which cards have incomplete information
- **Process Map**: Visualization of the business process chain
- **End of Life (EOL)**: End-of-support dates for technology products

---

## 7. Business Process Management (BPM)

The **BPM** module allows documenting and analyzing the organization's **business processes**.

### 7.1 Process Navigator

![Business Process Navigator](img/en/14_bpm_navigator.png)

The **Process Navigator** organizes processes into three main categories: **Management Processes** (planning and control), **Core Business Processes** (main business activity), and **Support Processes** (supporting main activities).

**Available Filters:** Type, Maturity (Initial/Defined/Managed/Optimized), Automation, Risk (Low/Medium/High/Critical), Depth (L1/L2/L3).

### 7.2 BPM Dashboard

![BPM Dashboard with Statistics](img/en/15_bpm_dashboard.png)

The **BPM Dashboard** provides an **executive view** of process status:

| Indicator | Description |
|-----------|-------------|
| **Total Processes** | Total number of documented processes |
| **Diagram Coverage** | Percentage of processes with associated diagrams |
| **High Risk** | Number of processes with high risk level |
| **Critical Risk** | Number of processes with critical risk level |

Includes charts showing distribution by process type, maturity, and automation level, plus a top risk processes table for **prioritizing investments**.

---

## 8. Diagrams

![Diagrams Section](img/en/16_diagrams.png)

The **Diagrams** module allows creating **visual representations** of the enterprise architecture. Features: drag and drop components, automatic connections between cards, customizable colors and shapes, export as image, and data synchronization.

---

## 9. EA Delivery

![EA Delivery Management](img/en/17_ea_delivery.png)

The **Delivery** module manages **initiatives and projects** related to enterprise architecture.

| Field | Description |
|-------|-------------|
| **Name** | Descriptive name of the project or program |
| **Type** | Project or Program |
| **Status** | On Track (green), At Risk (orange), Completed, etc. |
| **Artefacts** | Number of associated documents and diagrams |

Includes the ability to create a **Statement of Architecture Work (SoAW)** for each initiative.

---

## 10. Tasks and Surveys

![My Tasks Section](img/en/18_tasks.png)

The **Tasks** module centralizes all pending activities. Filters: **OPEN**, **DONE**, **ALL**. The **Surveys** tab allows collecting information from different stakeholders.

---

## 11. Administration

![User Menu with Administration Options](img/en/19_user_menu.png)

### 11.1 Metamodel

![Metamodel Configuration](img/en/20_admin_metamodel.png)

The **Metamodel** defines the platform's structure. Tabs: **Card Types**, **Relation Types**, **Calculations**, **Tags**, **Metamodel Graph**. Included types: Objective, Platform, Initiative, Organization, Business Capability, Business Context, Business Process, Application, Interface, Data Object, IT Component, Technology Category, Vendor/Provider.

### 11.2 Users & Roles

![User and Role Management](img/en/21_admin_users.png)

Manage users (Name, Email, Role, Auth, Status) and invite new members. Roles: **Admin** (full access), **Editor** (create/modify), **Viewer** (read-only), and custom roles.

---

## 12. Glossary of Terms

| Term | Definition |
|------|------------|
| **Enterprise Architecture (EA)** | The discipline that organizes and documents an organization's structure |
| **BPM** | Business Process Management |
| **Business Capability** | What an organization can do, regardless of how it does it |
| **Lifecycle** | Phases a component goes through: from creation to retirement |
| **Card** | The basic unit of information in Turbo EA representing a component |
| **Initiative** | A project or program involving changes to the architecture |
| **Metamodel** | The model that defines the platform's data structure |
| **Portfolio** | A collection of applications or technologies managed as a group |
| **SoAW** | Statement of Architecture Work |
| **Stakeholder** | A person with interest in or responsibility for a component |
| **SSO** | Single Sign-On - Login using corporate credentials |

---

**Turbo EA v0.17.4** | Enterprise Architecture Management Platform

*This manual was generated for platform evaluation by executives.*
